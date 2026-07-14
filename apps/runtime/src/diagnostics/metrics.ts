// FR-009: Bounded ring buffer and metric registration / recording.

import type { MetricDefinition } from "./types.js";
import { monotonicNow } from "./hooks.js";

// ── Ring Buffer ────────────────────────────────────────────────────────

const DEFAULT_CAPACITY = 10_000;

/**
 * Fixed-capacity ring buffer backed by typed arrays.
 *
 * Memory per buffer: `2 * capacity * 8` bytes (two Float64Arrays).
 * For the default 10,000 capacity that is ~160 KB.
 */
export class RingBuffer {
  private readonly values: Float64Array;
  private readonly timestamps: Float64Array;
  private readonly capacity: number;
  private writeIndex = 0;
  private count = 0;
  private overflow = 0;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    if (capacity <= 0) {
      throw new RangeError("RingBuffer capacity must be > 0");
    }
    this.capacity = capacity;
    this.values = new Float64Array(capacity);
    this.timestamps = new Float64Array(capacity);
  }

  /** Append a sample. Overwrites the oldest entry when full. */
  push(value: number, timestamp: number): void {
    if (this.count >= this.capacity) {
      this.overflow++;
    }
    this.values[this.writeIndex] = value;
    this.timestamps[this.writeIndex] = timestamp;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Return a *view* of valid value entries in insertion order.
   * The returned Float64Array is a **copy** (to provide correct ordering
   * when the buffer has wrapped).
   */
  getValues(): Float64Array {
    if (this.count === 0) {
      return new Float64Array(0);
    }
    if (this.count < this.capacity) {
      // No wrap yet — return a slice of the underlying buffer.
      return this.values.slice(0, this.count);
    }
    // Buffer has wrapped — stitch oldest..end + start..writeIndex.
    const result = new Float64Array(this.capacity);
    const tailLen = this.capacity - this.writeIndex;
    result.set(this.values.subarray(this.writeIndex, this.writeIndex + tailLen), 0);
    result.set(this.values.subarray(0, this.writeIndex), tailLen);
    return result;
  }

  /** Number of valid samples currently stored (up to capacity). */
  getCount(): number {
    return this.count;
  }

  /** Number of oldest samples that were overwritten. */
  getOverflowCount(): number {
    return this.overflow;
  }

  /** Reset the buffer to empty state. */
  clear(): void {
    this.writeIndex = 0;
    this.count = 0;
    this.overflow = 0;
  }
}

// ── Metrics Registry ───────────────────────────────────────────────────

interface MetricEntry {
  definition: MetricDefinition;
  buffer: RingBuffer | undefined; // lazy — created on first record
}

/**
 * Central registry where subsystems register metrics and record samples.
 * Buffers are lazily allocated on the first `record` call for each metric.
 */
export class MetricsRegistry {
  private readonly metrics = new Map<string, MetricEntry>();

  /**
   * Register a new metric.
   * @throws if a metric with the same name is already registered.
   */
  register(definition: MetricDefinition): void {
    if (this.metrics.has(definition.name)) {
      throw new Error(`Metric "${definition.name}" is already registered.`);
    }
    this.metrics.set(definition.name, { definition, buffer: undefined });
  }

  /**
   * Record a sample for the given metric.
   * If `timestamp` is omitted, `monotonicNow()` is used.
   * Recording to an unregistered metric is a no-op with a console warning.
   */
  record(name: string, value: number, timestamp?: number): void {
    const entry = this.metrics.get(name);
    if (entry === undefined) {
      console.warn(`[metrics] Attempted to record to unregistered metric "${name}"`);
      return;
    }
    // Lazy buffer allocation.
    if (entry.buffer === undefined) {
      entry.buffer = new RingBuffer(entry.definition.bufferSize ?? DEFAULT_CAPACITY);
    }
    entry.buffer.push(value, timestamp ?? monotonicNow());
  }

  /** Retrieve a metric's definition and buffer (if any samples recorded). */
  getMetric(name: string): { definition: MetricDefinition; buffer: RingBuffer } | undefined {
    const entry = this.metrics.get(name);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.buffer === undefined) {
      return undefined;
    }
    return { definition: entry.definition, buffer: entry.buffer };
  }

  /** Get definition even if no samples recorded yet. */
  getDefinition(name: string): MetricDefinition | undefined {
    return this.metrics.get(name)?.definition;
  }

  /** List all registered metric names. */
  listMetrics(): string[] {
    return [...this.metrics.keys()];
  }

  /** Remove a metric and free its buffer. */
  unregister(name: string): void {
    this.metrics.delete(name);
  }
}
