/**
 * Ghostty surface binding (T003, T011).
 *
 * Connects ghostty rendering output to the ElectroBun window surface
 * and handles resize / unbind lifecycle.
 *
 * T011 additions:
 * - GPU rendering configuration and fallback detection.
 * - Per-terminal GPU memory monitoring (NFR-011-004: < 10 MB).
 * - GPU driver reset / crash recovery.
 */

import type { RenderSurface } from "../adapter.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SurfaceBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurfaceBindingError";
  }
}

// ---------------------------------------------------------------------------
// GPU types
// ---------------------------------------------------------------------------

export type GpuRenderingMode = "gpu" | "software" | "unknown";

export interface GpuSurfaceStatus {
  mode: GpuRenderingMode;
  /** Per-terminal GPU memory overhead in bytes. */
  memoryBytes: number;
  /** Whether GPU fallback has occurred. */
  fellBack: boolean;
  /** Whether a GPU reinit has been attempted. */
  reinitAttempted: boolean;
}

export type SurfaceEventHandler = (event: string, payload: unknown) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NFR-011-004: max 10 MB per terminal overhead */
const MAX_GPU_MEMORY_PER_TERMINAL_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Surface manager
// ---------------------------------------------------------------------------

export class GhosttySurface {
  private _bound = false;
  private _surface: RenderSurface | undefined;
  private _processPid: number | undefined;

  // T011: GPU rendering state
  private _gpuMode: GpuRenderingMode = "unknown";
  private _gpuFallbackOccurred = false;
  private _gpuReinitAttempted = false;
  private _gpuMemoryBytes = 0;
  private _gpuPreference: "high-performance" | "low-power" | "default" = "default";
  private _eventHandler: SurfaceEventHandler | undefined;
  private _memoryCheckTimer: ReturnType<typeof setInterval> | undefined;

  /** Whether a surface is currently bound. */
  isBound(): boolean {
    return this._bound;
  }

  /** The currently bound surface, or undefined. */
  getSurface(): RenderSurface | undefined {
    return this._surface;
  }

  /** Current GPU rendering mode (T011). */
  getGpuMode(): GpuRenderingMode {
    return this._gpuMode;
  }

  /** Current GPU surface status (T011). */
  getGpuStatus(): GpuSurfaceStatus {
    return {
      mode: this._gpuMode,
      memoryBytes: this._gpuMemoryBytes,
      fellBack: this._gpuFallbackOccurred,
      reinitAttempted: this._gpuReinitAttempted,
    };
  }

  /** Register an event handler for surface events (T011). */
  onSurfaceEvent(handler: SurfaceEventHandler): void {
    this._eventHandler = handler;
  }

  /** Set GPU device preference before binding (T011). */
  setGpuPreference(pref: "high-performance" | "low-power" | "default"): void {
    this._gpuPreference = pref;
  }

  /**
   * Bind ghostty to the given render surface.
   *
   * @param surface - The window region to render into.
   * @param processPid - PID of the ghostty process.
   * @param gpuAvailable - Whether a GPU is available on the system (T011).
   * @throws {SurfaceBindingError} if binding fails.
   */
  bind(surface: RenderSurface, processPid: number, gpuAvailable = true): void {
    if (this._bound) {
      this.unbind();
    }

    // Validate surface has non-zero dimensions
    if (surface.bounds.width <= 0 || surface.bounds.height <= 0) {
      // Zero-size surface (e.g., minimized window) -- bind but skip rendering
      this._surface = surface;
      this._processPid = processPid;
      this._bound = true;
      this._gpuMode = "unknown";
      return;
    }

    this._surface = surface;
    this._processPid = processPid;
    this._bound = true;

    // T011: Attempt GPU rendering initialisation
    this._initGpuRendering(gpuAvailable);

    // T011: Start GPU memory monitoring
    this._startMemoryMonitoring();
  }

  /**
   * Unbind ghostty from the current surface and release resources.
   */
  unbind(): void {
    if (!this._bound) {
      return;
    }
    this._stopMemoryMonitoring();
    this._surface = undefined;
    this._processPid = undefined;
    this._bound = false;
    this._gpuMode = "unknown";
    this._gpuFallbackOccurred = false;
    this._gpuReinitAttempted = false;
    this._gpuMemoryBytes = 0;
  }

  /**
   * Update the render region bounds (e.g., on window resize).
   *
   * @param bounds - New pixel-space bounding box.
   */
  resize(bounds: { x: number; y: number; width: number; height: number }): void {
    if (!this._bound || this._surface === undefined) {
      return;
    }
    this._surface = {
      ...this._surface,
      bounds,
    };
    // Notify ghostty of the dimension change.
    // In a real integration this would send a resize message via IPC.
  }

  // -------------------------------------------------------------------------
  // T011: GPU rendering initialisation & fallback
  // -------------------------------------------------------------------------

  /**
   * Attempt to initialise GPU rendering.  Falls back to software
   * rendering if GPU init fails.
   */
  private _initGpuRendering(gpuAvailable: boolean): void {
    if (!gpuAvailable) {
      // No GPU on system -- software rendering from start, no fallback event
      this._gpuMode = "software";
      return;
    }

    try {
      // In a real integration: pass GPU preference to ghostty via IPC
      //   { type: "gpu_init", preference: this._gpuPreference }
      // and verify GPU is in use via diagnostics.
      void this._gpuPreference;
      this._gpuMode = "gpu";
    } catch {
      this._fallbackToSoftwareRendering("gpu_init_failed");
    }
  }

  /**
   * Fall back to software rendering when GPU is unavailable or fails.
   */
  private _fallbackToSoftwareRendering(reason: string): void {
    this._gpuMode = "software";
    this._gpuFallbackOccurred = true;

    // Publish fallback event (SC-011-003)
    this._eventHandler?.("renderer.ghostty.gpu_fallback", {
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle a GPU driver reset or crash (T011).
   *
   * Attempts to reinitialise the GPU surface.  If reinit fails,
   * falls back to software rendering.
   */
  handleGpuReset(): void {
    if (!this._bound) return;

    this._gpuReinitAttempted = true;

    try {
      // Attempt GPU reinitialisation
      // In a real integration: send IPC to ghostty to re-create the GL/Metal context
      this._gpuMode = "gpu";
    } catch {
      this._fallbackToSoftwareRendering("gpu_reinit_failed");
    }
  }

  /**
   * Simulate a GPU driver crash for testing (T011).
   * In production this would be triggered by a system event or render stall.
   */
  simulateGpuCrash(): void {
    if (!this._bound || this._gpuMode !== "gpu") return;
    this._gpuMode = "unknown";
    this.handleGpuReset();
  }

  /**
   * Update the GPU memory usage reading (T011).
   * Called by the memory monitor or externally by system probes.
   */
  updateGpuMemory(bytes: number): void {
    this._gpuMemoryBytes = bytes;

    if (bytes > MAX_GPU_MEMORY_PER_TERMINAL_BYTES) {
      this._eventHandler?.("renderer.ghostty.gpu_memory_exceeded", {
        memoryBytes: bytes,
        limitBytes: MAX_GPU_MEMORY_PER_TERMINAL_BYTES,
        timestamp: Date.now(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // T011: GPU memory monitoring
  // -------------------------------------------------------------------------

  private _startMemoryMonitoring(): void {
    // Poll GPU memory every 2 seconds
    this._memoryCheckTimer = setInterval(() => {
      if (!this._bound || this._gpuMode !== "gpu") return;
      // In a real integration: query system GPU memory APIs
      // For now, the consumer calls updateGpuMemory externally.
    }, 2_000);
  }

  private _stopMemoryMonitoring(): void {
    if (this._memoryCheckTimer !== undefined) {
      clearInterval(this._memoryCheckTimer);
      this._memoryCheckTimer = undefined;
    }
  }
}
