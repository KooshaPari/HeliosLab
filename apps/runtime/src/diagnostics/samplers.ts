// FR-005, FR-006: Memory and frame timing samplers.

import type { MetricsRegistry } from "./metrics.js";

// ── Memory Sampler ──────────────────────────────────────────────────────

/**
 * Periodically samples heap memory usage and records it to the metrics registry.
 * Values are recorded in megabytes.
 */
export class MemorySampler {
  private readonly registry: MetricsRegistry;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(registry: MetricsRegistry, intervalMs: number = 5000) {
    this.registry = registry;
    this.intervalMs = intervalMs;

    // Register the memory metric.
    this.registry.register({
      name: "memory",
      type: "gauge",
      unit: "MB",
      description: "Heap memory usage in megabytes",
    });
  }

  /** Begin periodic sampling. Multiple calls are idempotent. */
  start(): void {
    if (this.timer !== null) {
      return;
    }

    if (this.intervalMs < 500) {
      console.warn(
        `[samplers] Memory sampler interval ${this.intervalMs}ms is very short; may cause overhead.`
      );
    }

    this.timer = setInterval(() => {
      this.sample();
    }, this.intervalMs);
  }

  /** Stop periodic sampling. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Take a single memory sample. */
  private sample(): void {
    try {
      const heapUsedBytes = process.memoryUsage().heapUsed;
      const heapUsedMB = heapUsedBytes / (1024 * 1024);
      this.registry.record("memory", heapUsedMB);
    } catch {
      console.warn("[samplers] process.memoryUsage() not available; skipping sample.");
    }
  }
}

// ── Frame Timing Sampler ────────────────────────────────────────────────

/**
 * Tracks frame timing by counting `recordFrame` calls within 1-second windows.
 * At each window boundary, the computed FPS is recorded to the metrics registry.
 *
 * Actual wiring to the renderer is deferred to specs 010-013.
 */
export class FrameTimingSampler {
  private readonly registry: MetricsRegistry;
  private frameCount = 0;
  private windowStart = 0;
  private running = false;
  private zeroCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(registry: MetricsRegistry) {
    this.registry = registry;

    this.registry.register({
      name: "fps",
      type: "gauge",
      unit: "fps",
      description: "Frames per second",
    });
  }

  /** Start the frame timing sampler. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.frameCount = 0;
    this.windowStart = 0;

    // Check for zero-frame windows every second.
    this.zeroCheckTimer = setInterval(() => {
      if (this.windowStart > 0) {
        const now = performance.now();
        const elapsed = now - this.windowStart;
        if (elapsed >= 1000) {
          this.flushWindow(now);
        }
      }
    }, 1000);
  }

  /** Stop the frame timing sampler. */
  stop(): void {
    this.running = false;
    if (this.zeroCheckTimer !== null) {
      clearInterval(this.zeroCheckTimer);
      this.zeroCheckTimer = null;
    }
  }

  /**
   * Called by the renderer on each frame.
   * @param timestamp - monotonic timestamp in milliseconds (e.g. from performance.now()).
   */
  recordFrame(timestamp: number): void {
    if (!this.running) {
      return;
    }

    if (this.windowStart === 0) {
      this.windowStart = timestamp;
      this.frameCount = 1;
      return;
    }

    const elapsed = timestamp - this.windowStart;
    if (elapsed >= 1000) {
      this.flushWindow(timestamp);
    } else {
      this.frameCount++;
    }
  }

  private flushWindow(now: number): void {
    const fps = this.frameCount;
    this.registry.record("fps", fps);

    if (fps < 55) {
      console.warn(`[samplers] Low FPS detected: ${fps}`);
    }

    this.frameCount = 1;
    this.windowStart = now;
  }
}
