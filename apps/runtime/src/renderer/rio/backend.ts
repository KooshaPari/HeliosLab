/**
 * Rio renderer adapter — implements the RendererAdapter interface.
 *
 * Mirrors the structure of the ghostty backend (spec 011) and conforms
 * to the abstract contract defined in spec 010.
 */

import type { RendererAdapter, RendererConfig, RendererState, RenderSurface } from "../adapter.js";
import type { RendererCapabilities } from "../capabilities.js";
import type { RendererRegistry } from "../registry.js";
import { RioProcess } from "./process.js";
import { RioSurface } from "./surface.js";
import { RioCapabilities } from "./capabilities.js";
import { RioMetrics } from "./metrics.js";
import { RioInputRelay } from "./input.js";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class FeatureFlagDisabledError extends Error {
  constructor() {
    super("Rio renderer is disabled by feature flag");
    this.name = "FeatureFlagDisabledError";
  }
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export class RioBackend implements RendererAdapter {
  readonly id = "rio" as const;
  readonly version: string = "0.1.0";

  private _state: RendererState = "uninitialized";
  private _config: RendererConfig | undefined;
  private _process: RioProcess | undefined;
  private _surface: RioSurface | undefined;
  private _capabilities: RioCapabilities;
  private _metrics: RioMetrics;
  private _inputRelay: RioInputRelay;
  private _crashHandlers: Array<(error: Error) => void> = [];
  private _enabled = true;
  private _registry: RendererRegistry | undefined;
  private _fallbackInProgress = false;
  private _crashCount = 0;

  private readonly _streamBindings = new Map<
    string,
    { reader: ReadableStreamDefaultReader<Uint8Array>; aborted: boolean }
  >();

  constructor() {
    this._capabilities = new RioCapabilities();
    this._metrics = new RioMetrics();
    this._inputRelay = new RioInputRelay();
  }

  // -----------------------------------------------------------------------
  // Registry binding (for fallback)
  // -----------------------------------------------------------------------

  /** Bind a registry reference so fallback can find ghostty. */
  setRegistry(registry: RendererRegistry): void {
    this._registry = registry;
  }

  /** Get current crash count (for testing). */
  getCrashCount(): number {
    return this._crashCount;
  }

  /** Check if fallback is in progress. */
  isFallbackInProgress(): boolean {
    return this._fallbackInProgress;
  }

  // -----------------------------------------------------------------------
  // Feature-flag guard
  // -----------------------------------------------------------------------

  /** Disable this backend (rejects all operations). */
  setDisabled(): void {
    this._enabled = false;
  }

  private guardEnabled(): void {
    if (!this._enabled) {
      throw new FeatureFlagDisabledError();
    }
  }

  // -----------------------------------------------------------------------
  // RendererAdapter implementation
  // -----------------------------------------------------------------------

  async init(config: RendererConfig): Promise<void> {
    this.guardEnabled();
    if (this._state !== "uninitialized" && this._state !== "errored") {
      // Idempotent: already initialised.
      if (this._state === "running" || this._state === "initializing") {
        return;
      }
    }

    this._state = "initializing";
    this._config = config;

    try {
      this._process = new RioProcess();
      this._capabilities.detect(config);
      this._state = "running";
    } catch {
      this._state = "errored";
      throw err;
    }
  }

  async start(surface: RenderSurface): Promise<void> {
    this.guardEnabled();
    if (this._state !== "running" && this._state !== "initializing") {
      throw new Error(`Cannot start rio in state "${this._state}"`);
    }

    this._surface = new RioSurface();
    const pid = await this._process!.start({
      gpuAcceleration: this._config?.gpuAcceleration ?? false,
    });

    this._surface.bind(surface, pid.pid);

    // Set up crash detection forwarding with fallback.
    this._process!.onExit(code => {
      if (this._state === "running") {
        this._crashCount++;
        const error = new Error(`Rio process exited unexpectedly with code ${code}`);
        this._state = "errored";

        // Notify crash handlers.
        for (const handler of this._crashHandlers) {
          try {
            handler(error);
          } catch {
            // crash handlers must not throw
          }
        }

        // Attempt automatic fallback to ghostty.
        this._attemptFallback(error).catch(() => {
          // fallback errors are already handled inside _attemptFallback
        });
      }
    });

    this._state = "running";
    this._metrics.start();
  }

  async stop(): Promise<void> {
    if (this._state === "stopped" || this._state === "uninitialized") {
      return; // idempotent
    }
    this._state = "stopping";

    this._metrics.stop();

    // Abort all stream bindings.
    for (const [_ptyId, binding] of this._streamBindings) {
      binding.aborted = true;
      try {
        binding.reader.cancel().catch(() => {});
      } catch {
        // ignore
      }
    }
    this._streamBindings.clear();

    // Release surface.
    if (this._surface) {
      this._surface.unbind();
      this._surface = undefined;
    }

    // Stop process.
    if (this._process) {
      await this._process.stop();
      this._process = undefined;
    }

    this._state = "stopped";
  }

  bindStream(ptyId: string, stream: ReadableStream<Uint8Array>): void {
    this.guardEnabled();
    // Replace existing binding.
    const existing = this._streamBindings.get(ptyId);
    if (existing) {
      existing.aborted = true;
      existing.reader.cancel().catch(() => {});
    }

    const reader = stream.getReader();
    const _binding = { reader, aborted: false };
    this._streamBindings.set(ptyId, binding);

    // Pump loop — read from PTY stream, forward to rio process.
    const pump = async (): Promise<void> => {
      try {
        while (!binding.aborted) {
          const { done, value } = await reader.read();
          if (done || binding.aborted) break;
          if (value && this._process?.isRunning()) {
            this._process.writeToStdin(value);
          }
        }
      } catch {
        // Stream ended or errored — clean up.
      } finally {
        this._streamBindings.delete(ptyId);
      }
    };
    pump();
  }

  unbindStream(ptyId: string): void {
    const _binding = this._streamBindings.get(ptyId);
    if (!binding) return;
    binding.aborted = true;
    binding.reader.cancel().catch(() => {});
    this._streamBindings.delete(ptyId);
  }

  handleInput(ptyId: string, data: Uint8Array): void {
    this.guardEnabled();
    this._inputRelay.relay(ptyId, data);
  }

  resize(ptyId: string, cols: number, rows: number): void {
    this.guardEnabled();
    if (this._surface) {
      this._surface.resize({
        x: 0,
        y: 0,
        width: cols * 8, // approximate cell width
        height: rows * 16, // approximate cell height
      });
    }
  }

  queryCapabilities(): RendererCapabilities {
    return this._capabilities.get();
  }

  getState(): RendererState {
    return this._state;
  }

  onCrash(handler: (error: Error) => void): void {
    this._crashHandlers.push(handler);
  }

  // -----------------------------------------------------------------------
  // Fallback logic (T007)
  // -----------------------------------------------------------------------

  private static readonly FALLBACK_TIMEOUT_MS = 5000;

  /**
   * Attempt to fall back from rio to ghostty.
   *
   * Uses the renderer registry to find ghostty and switch to it.
   * If ghostty is unavailable or the switch fails, transitions to errored.
   */
  async _attemptFallback(_crashError: Error): Promise<void> {
    if (this._fallbackInProgress) return;
    this._fallbackInProgress = true;

    try {
      if (!this._registry) {
        // No registry — cannot fallback.
        this._state = "errored";
        return;
      }

      const _ghostty = this._registry.get("ghostty");
      if (!ghostty) {
        // Ghostty not available — escalate to errored.
        this._state = "errored";
        return;
      }

      // Collect current stream bindings for transfer.
      const boundPtyIds = [...this._streamBindings.keys()];

      // Stop rio (clean up remaining resources).
      this._metrics.stop();
      for (const [, binding] of this._streamBindings) {
        binding.aborted = true;
        try {
          binding.reader.cancel().catch(() => {});
        } catch {
          // ignore
        }
      }
      this._streamBindings.clear();
      if (this._surface) {
        this._surface.unbind();
        this._surface = undefined;
      }
      if (this._process) {
        // Process already exited (crash), just clean ref.
        this._process = undefined;
      }

      // Switch to ghostty with timeout.
      const switchPromise = this._switchToGhostty(ghostty, boundPtyIds);
      const timeout = new Promise<"timeout">(resolve =>
        setTimeout(() => resolve("timeout"), RioBackend.FALLBACK_TIMEOUT_MS)
      );

      const result = await Promise.race([switchPromise, timeout]);
      if (result === "timeout") {
        this._state = "errored";
        return;
      }

      // Success — ghostty is now active.
      this._registry.setActive("ghostty");
      this._state = "stopped";
    } catch {
      this._state = "errored";
    } finally {
      this._fallbackInProgress = false;
    }
  }

  private async _switchToGhostty(ghostty: RendererAdapter, _boundPtyIds: string[]): Promise<void> {
    const ghosttyState = ghostty.getState();
    if (
      ghosttyState === "uninitialized" ||
      ghosttyState === "stopped" ||
      ghosttyState === "errored"
    ) {
      // Use stored config or sensible defaults.
      const config: RendererConfig = this._config ?? {
        gpuAcceleration: false,
        colorDepth: 24,
        maxDimensions: { cols: 200, rows: 50 },
      };
      await ghostty.init(config);
    }
    // Note: actual PTY stream rebinding depends on the orchestration layer
    // (spec 010 switch transaction). The adapter signals readiness here.
  }

  // -----------------------------------------------------------------------
  // Metrics access
  // -----------------------------------------------------------------------

  getMetrics(): RioMetrics {
    return this._metrics;
  }

  // -----------------------------------------------------------------------
  // Re-enable support (for feature flag toggle)
  // -----------------------------------------------------------------------

  /** Re-enable this backend after it was disabled. */
  setEnabled(): void {
    this._enabled = true;
  }

  /** Check if the backend is enabled. */
  isEnabled(): boolean {
    return this._enabled;
  }
}
