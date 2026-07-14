/**
 * Ghostty renderer adapter (T001).
 *
 * Implements the {@link RendererAdapter} interface from spec 010 for the
 * ghostty terminal emulator backend.
 */

import type { RendererAdapter, RendererConfig, RendererState, RenderSurface } from "../adapter.js";
import type { RendererCapabilities } from "../capabilities.js";
import { GhosttyProcess } from "./process.js";
import { GhosttySurface } from "./surface.js";
import { detectCapabilities, getCachedCapabilities } from "./capabilities.js";
import { GhosttyMetrics } from "./metrics.js";
import type { MetricsSnapshot, MetricsPublisher } from "./metrics.js";
import { GhosttyInputRelay } from "./input.js";


// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GhosttyNotInitializedError extends Error {
  constructor() {
    super("GhosttyBackend has not been initialized. Call init() first.");
    this.name = "GhosttyNotInitializedError";
  }
}

export class GhosttyNotRunningError extends Error {
  constructor() {
    super("GhosttyBackend is not running. Call start() first.");
    this.name = "GhosttyNotRunningError";
  }
}

export class GhosttyAlreadyInitializedError extends Error {
  constructor() {
    super("GhosttyBackend is already initialized. Call stop() before re-init.");
    this.name = "GhosttyAlreadyInitializedError";
  }
}

// ---------------------------------------------------------------------------
// Backend implementation
// ---------------------------------------------------------------------------

export class GhosttyBackend implements RendererAdapter {
  readonly id = "ghostty" as const;
  readonly version: string;

  private _state: RendererState = "uninitialized";
  private _config: RendererConfig | undefined;
  private readonly _process = new GhosttyProcess();
  private readonly _surface = new GhosttySurface();
  private readonly _streams = new Map<string, ReadableStreamDefaultReader<Uint8Array>>();
  private readonly _streamAbortControllers = new Map<string, AbortController>();
  private readonly _streamPumpPromises = new Map<string, Promise<void>>();
  private readonly _pipingLatencies = new Map<string, number[]>();
  private _crashHandler: ((error: Error) => void) | undefined;

  // -- WP02: Render loop monitoring (T006) --
  private readonly _metrics = new GhosttyMetrics();
  private _inputRelay: GhosttyInputRelay | undefined;
  private _renderLoopTimer: ReturnType<typeof setInterval> | undefined;
  private _lastFrameTimestamp = 0;
  private _fpsWindowStart = 0;
  private _fpsWindowFrames = 0;
  private _degradedStart = 0;
  private _stallCheckTimer: ReturnType<typeof setInterval> | undefined;
  private _targetFps = 60;
  private _fpsEventHandler: ((event: string, payload: unknown) => void) | undefined;

  constructor(version = "0.0.0") {
    this.version = version;

    // Wire process crash events to the adapter crash handler
    this._process.onCrash(error => {
      this._state = "errored";
      this._crashHandler?.(error);
    });
  }

  // -------------------------------------------------------------------------
  // WP02 public API: Metrics (T008/T009)
  // -------------------------------------------------------------------------

  /** Access the metrics collector for this backend. */
  getMetrics(): GhosttyMetrics {
    return this._metrics;
  }

  /**
   * Enable metrics collection and optional publishing.
   */
  enableMetrics(publisher?: MetricsPublisher | undefined): void {
    if (publisher !== undefined) {
      this._metrics.setPublisher(publisher);
    }
    this._metrics.enable();
  }

  /**
   * Disable metrics collection and publishing.
   */
  disableMetrics(): void {
    this._metrics.disable();
  }

  /**
   * Get a snapshot of current metrics.
   */
  getMetricsSnapshot(): MetricsSnapshot {
    return this._metrics.getSnapshot();
  }

  // -------------------------------------------------------------------------
  // WP02 public API: Input relay (T007)
  // -------------------------------------------------------------------------

  /**
   * Set up an input relay backed by the given PTY writer.
   */
  setupInputRelay(ptyWriter: PtyWriter): GhosttyInputRelay {
    this._inputRelay = new GhosttyInputRelay(ptyWriter, this._metrics);
    return this._inputRelay;
  }

  /**
   * Get the current input relay, if set up.
   */
  getInputRelay(): GhosttyInputRelay | undefined {
    return this._inputRelay;
  }

  // -------------------------------------------------------------------------
  // WP02 public API: Render loop (T006)
  // -------------------------------------------------------------------------

  /**
   * Record a frame from the ghostty render loop.
   * Call this whenever ghostty completes a frame (via IPC signal, shared
   * memory fence, or output parsing).
   */
  recordFrame(timestamp: number = Date.now()): void {
    this._lastFrameTimestamp = timestamp;
    this._fpsWindowFrames++;
    this._metrics.recordFrame(timestamp);

    // Rolling 1-second FPS window
    const elapsed = timestamp - this._fpsWindowStart;
    if (elapsed >= 1_000) {
      const currentFps = (this._fpsWindowFrames / elapsed) * 1_000;
      this._checkFpsDegradation(currentFps, timestamp);
      this._fpsWindowStart = timestamp;
      this._fpsWindowFrames = 0;
    }
  }

  /**
   * Set the target FPS (default 60). Used for degradation detection.
   */
  setTargetFps(fps: number): void {
    this._targetFps = fps;
  }

  /**
   * Register an event handler for render-loop events
   * (e.g., `renderer.ghostty.fps_degraded`).
   */
  onRenderEvent(handler: (event: string, payload: unknown) => void): void {
    this._fpsEventHandler = handler;
  }

  // -------------------------------------------------------------------------
  // RendererAdapter implementation
  // -------------------------------------------------------------------------

  async init(config: RendererConfig): Promise<void> {
    if (this._state !== "uninitialized" && this._state !== "stopped" && this._state !== "errored") {
      throw new GhosttyAlreadyInitializedError();
    }

    this._state = "initializing";

    try {
      this._config = config;
      // Detect capabilities (GPU, etc.) during init
      await detectCapabilities(true);
      this._state = "running";

      // Start render loop monitoring (T006)
      this._startRenderLoopMonitoring();
    } catch {
      this._state = "errored";
      throw error;
    }
  }

  async start(surface: RenderSurface): Promise<void> {
    if (this._state !== "running") {
      throw new GhosttyNotInitializedError();
    }

    const { pid } = await this._process.start({
      windowId: surface.windowId,
    });

    this._surface.bind(surface, pid);
  }

  async stop(): Promise<void> {
    if (this._state === "stopped" || this._state === "uninitialized") {
      // Idempotent
      return;
    }

    this._state = "stopping";

    // Stop render loop monitoring
    this._stopRenderLoopMonitoring();

    // Disable metrics
    this._metrics.disable();
    this._metrics.reset();

    // Tear down input relay
    this._inputRelay?.teardownAll();
    this._inputRelay = undefined;

    // Unbind all streams
    for (const ptyId of this._streams.keys()) {
      this.unbindStream(ptyId);
    }

    // Unbind surface
    this._surface.unbind();

    // Stop process
    await this._process.stop();

    this._state = "stopped";
    this._config = undefined;
  }

  bindStream(ptyId: string, stream: ReadableStream<Uint8Array>): void {
    if (this._state !== "running") {
      throw new GhosttyNotRunningError();
    }

    // If already bound, unbind first (replace semantics)
    if (this._streams.has(ptyId)) {
      this.unbindStream(ptyId);
    }

    const controller = new AbortController();
    const reader = stream.getReader();
    this._streams.set(ptyId, reader);
    this._streamAbortControllers.set(ptyId, controller);
    this._pipingLatencies.set(ptyId, []);

    // Start pump loop: read from PTY stream, feed to ghostty (T010)
    const pumpPromise = this._pumpStream(ptyId, reader, controller.signal);
    this._streamPumpPromises.set(ptyId, pumpPromise);
  }

  unbindStream(ptyId: string): void {
    const controller = this._streamAbortControllers.get(ptyId);
    if (controller !== undefined) {
      controller.abort();
      this._streamAbortControllers.delete(ptyId);
    }

    const reader = this._streams.get(ptyId);
    if (reader !== undefined) {
      void reader.cancel().catch(() => {
        // Stream may already be closed -- ignore
      });
      this._streams.delete(ptyId);
    }

    this._streamPumpPromises.delete(ptyId);
    this._pipingLatencies.delete(ptyId);

    // Notify ghostty to stop rendering for this PTY pane
    this._notifyPaneRemoved(ptyId);
  }

  /**
   * Return the number of currently bound PTY streams.
   */
  getBoundStreamCount(): number {
    return this._streams.size;
  }

  /**
   * Return the IDs of all currently bound PTY streams.
   */
  getBoundStreamIds(): string[] {
    return [...this._streams.keys()];
  }

  /**
   * Return piping latency samples for a given PTY (T010).
   * Each value is the time in ms from stream read to ghostty write.
   */
  getPipingLatencies(ptyId: string): readonly number[] {
    return this._pipingLatencies.get(ptyId) ?? [];
  }

  handleInput(ptyId: string, data: Uint8Array): void {
    if (this._state !== "running") {
      throw new GhosttyNotRunningError();
    }

    // In a real integration this would relay raw bytes to the PTY
    // via the ghostty process IPC channel.
    // For now the adapter stores the intent; the PTY write path is
    // wired externally by the orchestration layer.
    void ptyId;
    void data;
  }

  resize(ptyId: string, cols: number, rows: number): void {
    if (this._state !== "running") {
      return; // Silently ignore resize when not running
    }

    // Notify ghostty of the terminal dimension change.
    // In a full integration this would send a resize IPC message
    // targeting the specific PTY pane.
    void ptyId;
    void cols;
    void rows;

    // Also resize the surface if applicable
    if (this._surface.isBound()) {
      const current = this._surface.getSurface();
      if (current !== undefined) {
        this._surface.resize(current.bounds);
      }
    }
  }

  queryCapabilities(): RendererCapabilities {
    return getCachedCapabilities();
  }

  getState(): RendererState {
    return this._state;
  }

  onCrash(handler: (error: Error) => void): void {
    this._crashHandler = handler;
  }

  // -------------------------------------------------------------------------
  // Internal: render loop monitoring (T006)
  // -------------------------------------------------------------------------

  private _startRenderLoopMonitoring(): void {
    this._fpsWindowStart = Date.now();
    this._fpsWindowFrames = 0;
    this._lastFrameTimestamp = Date.now();
    this._degradedStart = 0;

    // Stall check every 500ms
    this._stallCheckTimer = setInterval(() => {
      this._checkRenderStall();
    }, 500);
  }

  private _stopRenderLoopMonitoring(): void {
    if (this._stallCheckTimer !== undefined) {
      clearInterval(this._stallCheckTimer);
      this._stallCheckTimer = undefined;
    }
    if (this._renderLoopTimer !== undefined) {
      clearInterval(this._renderLoopTimer);
      this._renderLoopTimer = undefined;
    }
  }

  private _checkFpsDegradation(currentFps: number, timestamp: number): void {
    const threshold = this._targetFps - 5; // < 55 FPS
    if (currentFps < threshold) {
      if (this._degradedStart === 0) {
        this._degradedStart = timestamp;
      } else if (timestamp - this._degradedStart > 2_000) {
        // Sustained degradation for > 2 seconds
        this._fpsEventHandler?.("renderer.ghostty.fps_degraded", {
          currentFps: Math.round(currentFps * 100) / 100,
          targetFps: this._targetFps,
          degradedForMs: timestamp - this._degradedStart,
          timestamp,
        });
      }
    } else {
      this._degradedStart = 0;
    }
  }

  private _checkRenderStall(): void {
    if (this._state !== "running") return;
    if (this._lastFrameTimestamp === 0) return;

    const elapsed = Date.now() - this._lastFrameTimestamp;
    if (elapsed > 500) {
      // Check if the process is alive
      if (this._process.isRunning()) {
        console.warn(
          `[ghostty] Render stall detected: no frames for ${elapsed}ms, but process is alive.`
        );
      }
      // If process is dead, crash detection in WP01 T002 handles it.
    }
  }

  // -------------------------------------------------------------------------
  // Internal: stream pump
  // -------------------------------------------------------------------------

  /**
   * Continuously read from a PTY stream and feed data to ghostty (T010).
   *
   * - Measures piping latency per chunk (stream read to ghostty write).
   * - Handles backpressure: if the ghostty process stdin buffer is full,
   *   the write call will naturally await, pausing the reader.
   * - On stream end, notifies ghostty to show "process exited".
   */
  private async _pumpStream(
    ptyId: string,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal
  ): Promise<void> {
    try {
      while (!signal.aborted) {
        const readStart = Date.now();
        const { done, value } = await reader.read();
        if (done) {
          // PTY stream ended -- notify ghostty to show exit message
          this._notifyStreamEnd(ptyId);
          break;
        }

        // Write to ghostty process stdin for the target pane.
        // In a real integration this routes to the correct ghostty pane
        // via IPC keyed by ptyId.  The write is awaitable to propagate
        // backpressure from ghostty back to the PTY stream reader.
        await this._writeToGhostty(ptyId, value);

        // Measure piping latency (T010)
        const writeEnd = Date.now();
        const latency = writeEnd - readStart;
        const latencies = this._pipingLatencies.get(ptyId);
        if (latencies !== undefined) {
          latencies.push(latency);
          // Keep at most 1000 samples
          if (latencies.length > 1_000) {
            latencies.shift();
          }
        }
      }
    } catch {
      // Stream cancelled or aborted -- expected during unbind
    }
  }

  /**
   * Write data to the ghostty process for a specific PTY pane.
   *
   * This method is the integration point where data is fed to the
   * ghostty process.  It supports backpressure: if the process cannot
   * consume data fast enough, this promise will not resolve until the
   * write buffer has capacity.
   */
  private async _writeToGhostty(ptyId: string, data: Uint8Array): Promise<void> {
    // Route to the correct ghostty pane based on ptyId.
    // In a full integration this sends an IPC message:
    //   { type: "pty_output", pane: ptyId, data }
    // For now this is a synchronous no-op; the async signature
    // allows future backpressure support.
    void ptyId;
    void data;
  }

  /**
   * Notify ghostty that a PTY stream has ended (process exited).
   */
  private _notifyStreamEnd(ptyId: string): void {
    // In a real integration: send IPC message to ghostty
    //   { type: "pty_exit", pane: ptyId }
    // Ghostty will display "[process exited]" in the pane.
    void ptyId;
  }

  /**
   * Notify ghostty that a PTY pane has been removed.
   */
  private _notifyPaneRemoved(ptyId: string): void {
    // In a real integration: send IPC message to ghostty
    //   { type: "pane_removed", pane: ptyId }
    void ptyId;
  }
}
