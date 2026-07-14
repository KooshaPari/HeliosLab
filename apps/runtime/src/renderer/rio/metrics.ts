/**
 * Rio frame metrics collection.
 *
 * Uses the same MetricsSnapshot type and event schema as ghostty for
 * renderer-agnostic monitoring dashboards.
 */

// ---------------------------------------------------------------------------
// Types — identical schema to ghostty metrics
// ---------------------------------------------------------------------------

export interface MetricsSnapshot {
  rendererId: "rio" | "ghostty";
  timestamp: number;
  frameTimeMs: number;
  fps: number;
  inputLatencyMs: number;
  frameCount: number;
  droppedFrames: number;
}

export interface MetricsSummary {
  rendererId: "rio" | "ghostty";
  frameTime: { p50: number; p95: number; min: number; max: number };
  fps: { p50: number; p95: number; min: number; max: number };
  inputLatency: { p50: number; p95: number; min: number; max: number };
  totalFrames: number;
  totalDroppedFrames: number;
  windowDurationMs: number;
}

// ---------------------------------------------------------------------------
// Metrics collector
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_SIZE = 120; // rolling window of samples
const DEFAULT_INTERVAL_MS = 1000; // 1 second collection interval

export class RioMetrics {
  private _snapshots: MetricsSnapshot[] = [];
  private _collecting = false;
  private _intervalHandle: ReturnType<typeof setInterval> | undefined;
  private _frameCount = 0;
  private _droppedFrames = 0;
  private _startedAt: number | undefined;
  private readonly _windowSize: number;
  private readonly _intervalMs: number;

  constructor(windowSize: number = DEFAULT_WINDOW_SIZE, intervalMs: number = DEFAULT_INTERVAL_MS) {
    this._windowSize = windowSize;
    this._intervalMs = intervalMs;
  }

  /**
   * Start collecting metrics at the configured interval.
   */
  start(): void {
    if (this._collecting) return;
    this._collecting = true;
    this._startedAt = Date.now();
    this._frameCount = 0;
    this._droppedFrames = 0;

    this._intervalHandle = setInterval(() => {
      this.recordSnapshot();
    }, this._intervalMs);
  }

  /**
   * Stop collecting metrics.
   */
  stop(): void {
    if (!this._collecting) return;
    this._collecting = false;
    if (this._intervalHandle !== undefined) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = undefined;
    }
  }

  /**
   * Record a frame event (called by the render loop).
   */
  recordFrame(frameTimeMs: number, inputLatencyMs: number, dropped = false): void {
    this._frameCount++;
    if (dropped) this._droppedFrames++;

    const snapshot: MetricsSnapshot = {
      rendererId: "rio",
      timestamp: Date.now(),
      frameTimeMs,
      fps: frameTimeMs > 0 ? 1000 / frameTimeMs : 0,
      inputLatencyMs,
      frameCount: this._frameCount,
      droppedFrames: this._droppedFrames,
    };

    this._snapshots.push(snapshot);
    if (this._snapshots.length > this._windowSize) {
      this._snapshots.shift();
    }
  }

  /**
   * Record a synthetic snapshot at the collection interval.
   */
  private recordSnapshot(): void {
    if (this._snapshots.length === 0) {
      // No frames recorded yet — emit a zero snapshot.
      this._snapshots.push({
        rendererId: "rio",
        timestamp: Date.now(),
        frameTimeMs: 0,
        fps: 0,
        inputLatencyMs: 0,
        frameCount: this._frameCount,
        droppedFrames: this._droppedFrames,
      });
    }
  }

  /**
   * Return a summary of the current rolling window.
   */
  getSummary(): MetricsSummary {
    const snaps = this._snapshots;
    const empty = {
      p50: 0,
      p95: 0,
      min: 0,
      max: 0,
    };

    if (snaps.length === 0) {
      return {
        rendererId: "rio",
        frameTime: { ...empty },
        fps: { ...empty },
        inputLatency: { ...empty },
        totalFrames: 0,
        totalDroppedFrames: 0,
        windowDurationMs: 0,
      };
    }

    return {
      rendererId: "rio",
      frameTime: percentiles(snaps.map(s => s.frameTimeMs)),
      fps: percentiles(snaps.map(s => s.fps)),
      inputLatency: percentiles(snaps.map(s => s.inputLatencyMs)),
      totalFrames: this._frameCount,
      totalDroppedFrames: this._droppedFrames,
      windowDurationMs: this._startedAt ? Date.now() - this._startedAt : 0,
    };
  }

  /**
   * Return raw snapshots (for testing / export).
   */
  getSnapshots(): readonly MetricsSnapshot[] {
    return this._snapshots;
  }

  isCollecting(): boolean {
    return this._collecting;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentiles(values: number[]): {
  p50: number;
  p95: number;
  min: number;
  max: number;
} {
  if (values.length === 0) return { p50: 0, p95: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}
