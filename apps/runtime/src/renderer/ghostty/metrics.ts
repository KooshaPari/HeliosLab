/**
 * Ghostty frame metrics collection and publishing (T008, T009).
 *
 * Tracks per-frame rendering data, calculates rolling percentile metrics,
 * and publishes them to the local bus at configurable intervals.
 *
 * Design goals:
 * - Zero overhead when disabled.
 * - Pre-allocated ring buffers to avoid GC pressure.
 * - Per-frame overhead < 0.1ms when enabled.
 * - First metrics event within 1 second of enabling (SC-011-004).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrameSample {
  frameNumber: number;
  frameTimeMs: number;
  fpsInstant: number;
  timestamp: number;
}

export interface InputLatencySample {
  inputTimestamp: number;
  echoTimestamp: number;
  latencyMs: number;
}

export interface MetricsSnapshot {
  avgFps: number;
  p50FrameTime: number;
  p95FrameTime: number;
  droppedFrames: number;
  p50InputLatency: number;
  p95InputLatency: number;
  timestamp: number;
  rendererId: "ghostty";
}

export interface MetricsConfig {
  /** Rolling window size in milliseconds. Default 1000. */
  windowMs?: number | undefined;
  /** Publishing interval in milliseconds. Default 1000. 0 disables periodic publishing. */
  publishIntervalMs?: number | undefined;
  /** Target FPS for dropped-frame detection. Default 60. */
  targetFps?: number | undefined;
}

/**
 * Callback signature for metrics publishing.
 * The consumer (local bus) receives the event topic and payload.
 */
export type MetricsPublisher = (topic: string, payload: MetricsSnapshot) => void;

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

/**
 * Fixed-capacity ring buffer storing numbers.  Pre-allocated to avoid
 * GC pressure during hot paths.
 */
class NumberRingBuffer {
  private readonly _data: Float64Array;
  private readonly _capacity: number;
  private _head = 0;
  private _size = 0;

  constructor(capacity: number) {
    this._capacity = capacity;
    this._data = new Float64Array(capacity);
  }

  push(value: number): void {
    this._data[this._head] = value;
    this._head = (this._head + 1) % this._capacity;
    if (this._size < this._capacity) {
      this._size++;
    }
  }

  get size(): number {
    return this._size;
  }

  /**
   * Return a sorted copy of the current values (for percentile calculation).
   * Allocates a new array -- call sparingly (once per publish interval).
   */
  sorted(): Float64Array {
    if (this._size === 0) return new Float64Array(0);

    const out = new Float64Array(this._size);
    if (this._size < this._capacity) {
      // Buffer hasn't wrapped yet
      out.set(this._data.subarray(0, this._size));
    } else {
      // Wrapped: copy tail then head
      const tailLen = this._capacity - this._head;
      out.set(this._data.subarray(this._head, this._head + tailLen), 0);
      out.set(this._data.subarray(0, this._head), tailLen);
    }
    out.sort();
    return out;
  }

  clear(): void {
    this._head = 0;
    this._size = 0;
  }
}

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

function percentile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

// ---------------------------------------------------------------------------
// GhosttyMetrics
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_MS = 1_000;
const DEFAULT_PUBLISH_INTERVAL_MS = 1_000;
const DEFAULT_TARGET_FPS = 60;
const RING_CAPACITY = 512; // enough for ~8 seconds at 60 FPS

export class GhosttyMetrics {
  private readonly _frameTimes = new NumberRingBuffer(RING_CAPACITY);
  private readonly _inputLatencies = new NumberRingBuffer(RING_CAPACITY);

  private readonly _windowMs: number;
  private readonly _publishIntervalMs: number;
  private readonly _targetFps: number;
  private readonly _targetFrameTimeMs: number;

  private _enabled = false;
  private _frameCount = 0;
  private _droppedFrames = 0;
  private _lastFrameTimestamp = 0;
  private _windowStartTimestamp = 0;
  private _framesInWindow = 0;

  private _publisher: MetricsPublisher | undefined;
  private _publishTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: MetricsConfig = {}) {
    this._windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
    this._publishIntervalMs = config.publishIntervalMs ?? DEFAULT_PUBLISH_INTERVAL_MS;
    this._targetFps = config.targetFps ?? DEFAULT_TARGET_FPS;
    this._targetFrameTimeMs = 1_000 / this._targetFps;
  }

  // -----------------------------------------------------------------------
  // Enable / disable
  // -----------------------------------------------------------------------

  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Enable metrics collection. If a publisher is registered and
   * publishIntervalMs > 0, starts periodic publishing.
   */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._windowStartTimestamp = Date.now();
    this._startPublishing();
  }

  /**
   * Disable metrics collection and stop publishing.
   */
  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._stopPublishing();
  }

  // -----------------------------------------------------------------------
  // Publisher
  // -----------------------------------------------------------------------

  /**
   * Register a publisher callback for metrics events.
   * If metrics are already enabled, starts publishing immediately.
   */
  setPublisher(publisher: MetricsPublisher): void {
    this._publisher = publisher;
    if (this._enabled) {
      this._startPublishing();
    }
  }

  /**
   * Remove the current publisher.
   */
  clearPublisher(): void {
    this._stopPublishing();
    this._publisher = undefined;
  }

  // -----------------------------------------------------------------------
  // Frame recording
  // -----------------------------------------------------------------------

  /**
   * Record a frame completion. Call this once per rendered frame.
   *
   * @param timestamp - High-resolution timestamp of frame completion
   *                    (e.g., performance.now() or Date.now()).
   */
  recordFrame(timestamp: number = Date.now()): void {
    if (!this._enabled) return;

    this._frameCount++;
    this._framesInWindow++;

    if (this._lastFrameTimestamp > 0) {
      const frameTimeMs = timestamp - this._lastFrameTimestamp;
      this._frameTimes.push(frameTimeMs);

      // Dropped frame: frame time exceeds 2x target
      if (frameTimeMs > this._targetFrameTimeMs * 2) {
        this._droppedFrames++;
      }
    }

    this._lastFrameTimestamp = timestamp;

    // Roll window
    const elapsed = timestamp - this._windowStartTimestamp;
    if (elapsed >= this._windowMs) {
      this._windowStartTimestamp = timestamp;
      this._framesInWindow = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Input latency recording
  // -----------------------------------------------------------------------

  /**
   * Record an input-to-echo latency measurement.
   *
   * @param inputTimestamp - When the input event was received.
   * @param echoTimestamp  - When the echo was rendered.
   */
  recordInputLatency(inputTimestamp: number, echoTimestamp: number): void {
    if (!this._enabled) return;
    const latencyMs = echoTimestamp - inputTimestamp;
    this._inputLatencies.push(latencyMs);
  }

  // -----------------------------------------------------------------------
  // Snapshot
  // -----------------------------------------------------------------------

  /**
   * Return a snapshot of the current rolling metrics.
   */
  getSnapshot(): MetricsSnapshot {
    const now = Date.now();

    const sortedFrameTimes = this._frameTimes.sorted();
    const sortedInputLatencies = this._inputLatencies.sorted();

    // Average FPS: based on frame times in the buffer
    let avgFps = 0;
    if (sortedFrameTimes.length > 0) {
      let sum = 0;
      for (let i = 0; i < sortedFrameTimes.length; i++) {
        sum += sortedFrameTimes[i] ?? 0;
      }
      const avgFrameTime = sum / sortedFrameTimes.length;
      avgFps = avgFrameTime > 0 ? 1_000 / avgFrameTime : 0;
    }

    return {
      avgFps: Math.round(avgFps * 100) / 100,
      p50FrameTime: Math.round(percentile(sortedFrameTimes, 50) * 100) / 100,
      p95FrameTime: Math.round(percentile(sortedFrameTimes, 95) * 100) / 100,
      droppedFrames: this._droppedFrames,
      p50InputLatency: Math.round(percentile(sortedInputLatencies, 50) * 100) / 100,
      p95InputLatency: Math.round(percentile(sortedInputLatencies, 95) * 100) / 100,
      timestamp: now,
      rendererId: "ghostty",
    };
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  /**
   * Clear all collected metrics.
   */
  reset(): void {
    this._frameTimes.clear();
    this._inputLatencies.clear();
    this._frameCount = 0;
    this._droppedFrames = 0;
    this._lastFrameTimestamp = 0;
    this._windowStartTimestamp = 0;
    this._framesInWindow = 0;
  }

  // -----------------------------------------------------------------------
  // Internal publishing
  // -----------------------------------------------------------------------

  private _startPublishing(): void {
    if (this._publishTimer !== undefined) return;
    if (this._publisher === undefined) return;
    if (this._publishIntervalMs <= 0) return;

    this._publishTimer = setInterval(() => {
      this._publish();
    }, this._publishIntervalMs);
  }

  private _stopPublishing(): void {
    if (this._publishTimer !== undefined) {
      clearInterval(this._publishTimer);
      this._publishTimer = undefined;
    }
  }

  private _publish(): void {
    if (this._publisher === undefined || !this._enabled) return;

    try {
      const snapshot = this.getSnapshot();
      this._publisher("renderer.ghostty.metrics", snapshot);
    } catch {
      // Fire-and-forget: do not block the render path
    }
  }
}
