/**
 * Bounded output buffering with backpressure signaling and overflow telemetry.
 *
 * Provides a fixed-capacity {@link RingBuffer} backed by a pre-allocated
 * ArrayBuffer, and an {@link OutputBuffer} wrapper that adds backpressure
 * events and overflow statistics.
 *
 * @module
 */

import type { BusPublisher, PtyEventCorrelation } from "./events.js";
import { emitPtyEvent } from "./events.js";

// ── Ring Buffer ──────────────────────────────────────────────────────────────

/**
 * Result of a write operation on the ring buffer.
 */
export interface RingWriteResult {
  /** Number of bytes actually written into the buffer. */
  readonly written: number;
  /** Number of bytes dropped because the buffer was full. */
  readonly dropped: number;
}

/**
 * Fixed-capacity ring buffer backed by a pre-allocated ArrayBuffer.
 *
 * All operations are O(1). The buffer uses head/tail pointers with
 * wrap-around support. When the buffer is full, writes drop the
 * overflow bytes silently.
 */
export class RingBuffer {
  private readonly buffer: Uint8Array;
  private readonly _capacity: number;

  /** Index of the next byte to read. */
  private head = 0;
  /** Number of bytes currently stored. */
  private _size = 0;

  /**
   * @param capacity - Buffer capacity in bytes.
   */
  constructor(capacity: number) {
    if (capacity <= 0 || !Number.isInteger(capacity)) {
      throw new Error(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this._capacity = capacity;
    this.buffer = new Uint8Array(new ArrayBuffer(capacity));
  }

  /** Total buffer capacity in bytes. */
  get capacity(): number {
    return this._capacity;
  }

  /** Number of bytes available to read. */
  get available(): number {
    return this._size;
  }

  /** Current utilization as a fraction [0, 1]. */
  get utilization(): number {
    return this._capacity === 0 ? 0 : this._size / this._capacity;
  }

  /**
   * Write data into the buffer. If there is insufficient space, only
   * the bytes that fit are written; the rest are dropped.
   *
   * @param data - Bytes to write.
   * @returns Write result with written and dropped counts.
   */
  write(data: Uint8Array): RingWriteResult {
    const freeSpace = this._capacity - this._size;
    const written = Math.min(data.length, freeSpace);
    const dropped = data.length - written;

    if (written === 0) {
      return { written: 0, dropped };
    }

    // Tail is where the next write goes.
    const tail = (this.head + this._size) % this._capacity;

    // Check if write wraps around.
    const firstChunk = Math.min(written, this._capacity - tail);
    this.buffer.set(data.subarray(0, firstChunk), tail);

    if (firstChunk < written) {
      // Wrap around to the beginning.
      this.buffer.set(data.subarray(firstChunk, written), 0);
    }

    this._size += written;
    return { written, dropped };
  }

  /**
   * Read up to `count` bytes without removing them from the buffer.
   *
   * @param count - Maximum number of bytes to peek (default: all available).
   * @returns A copy of the peeked bytes.
   */
  peek(count?: number): Uint8Array {
    const n = Math.min(count ?? this._size, this._size);
    if (n === 0) return new Uint8Array(0);

    const result = new Uint8Array(n);
    const firstChunk = Math.min(n, this._capacity - this.head);
    result.set(this.buffer.subarray(this.head, this.head + firstChunk));

    if (firstChunk < n) {
      result.set(this.buffer.subarray(0, n - firstChunk), firstChunk);
    }

    return result;
  }

  /**
   * Read and remove up to `count` bytes from the buffer.
   *
   * @param count - Maximum number of bytes to consume (default: all available).
   * @returns A copy of the consumed bytes.
   */
  consume(count?: number): Uint8Array {
    const result = this.peek(count);
    this.head = (this.head + result.length) % this._capacity;
    this._size -= result.length;
    return result;
  }

  /**
   * Discard all data in the buffer.
   */
  clear(): void {
    this.head = 0;
    this._size = 0;
  }
}

// ── Buffer Statistics ────────────────────────────────────────────────────────

/** Cumulative statistics for an output buffer. */
export interface BufferStats {
  readonly totalWritten: number;
  readonly totalDropped: number;
  readonly overflowEvents: number;
  readonly capacity: number;
  readonly currentSize: number;
  readonly utilization: number;
}

// ── Output Buffer Configuration ──────────────────────────────────────────────

/** Configuration for the output buffer. */
export interface OutputBufferConfig {
  /** Buffer capacity in bytes (default: 4 * 1024 * 1024 = 4MB). */
  capacityBytes?: number;
  /** Utilization threshold to trigger backpressure (default: 0.75). */
  backpressureThreshold?: number;
  /** Hysteresis band below the threshold to release backpressure (default: 0.1). */
  hysteresisBand?: number;
  /** Minimum interval between overflow events per PTY in ms (default: 1000). */
  overflowDebounceMs?: number;
}

// ── Output Buffer ────────────────────────────────────────────────────────────

/**
 * Output buffer wrapping a {@link RingBuffer} with backpressure signaling
 * and overflow telemetry.
 *
 * Emits:
 * - `pty.backpressure.on` when utilization crosses above the backpressure threshold.
 * - `pty.backpressure.off` when utilization drops below (threshold - hysteresis).
 * - `pty.buffer.overflow` (debounced, max 1/sec) when data is dropped.
 */
export class OutputBuffer {
  private readonly ring: RingBuffer;
  private readonly bus: BusPublisher;
  private readonly correlation: PtyEventCorrelation;
  private readonly backpressureThreshold: number;
  private readonly hysteresisLow: number;
  private readonly overflowDebounceMs: number;

  /** Whether backpressure is currently signaled. */
  private backpressureActive = false;

  /** Cumulative counters. */
  private _totalWritten = 0;
  private _totalDropped = 0;
  private _overflowEvents = 0;

  /** Timestamp of last overflow event emission. */
  private lastOverflowEventTs = 0;

  /** Whether the first overflow warning has been logged. */
  private firstOverflowLogged = false;

  constructor(bus: BusPublisher, correlation: PtyEventCorrelation, config?: OutputBufferConfig) {
    const capacity = config?.capacityBytes ?? 4 * 1024 * 1024;
    this.ring = new RingBuffer(capacity);
    this.bus = bus;
    this.correlation = correlation;
    this.backpressureThreshold = config?.backpressureThreshold ?? 0.75;
    this.hysteresisLow = this.backpressureThreshold - (config?.hysteresisBand ?? 0.1);
    this.overflowDebounceMs = config?.overflowDebounceMs ?? 1000;
  }

  /**
   * Write output data into the buffer. Handles backpressure signaling
   * and overflow telemetry automatically.
   *
   * @param data - Output bytes to buffer.
   * @returns The ring buffer write result.
   */
  write(data: Uint8Array): RingWriteResult {
    const result = this.ring.write(data);

    this._totalWritten += result.written;
    this._totalDropped += result.dropped;

    // ── Overflow telemetry (T014) ──
    if (result.dropped > 0) {
      this.handleOverflow(result.dropped);
    }

    // ── Backpressure signaling (T013) ──
    this.checkBackpressure();

    return result;
  }

  /**
   * Consume buffered output data.
   *
   * @param count - Maximum number of bytes to consume (default: all).
   * @returns Consumed bytes.
   */
  consume(count?: number): Uint8Array {
    const result = this.ring.consume(count);
    // After consuming, check if backpressure can be released.
    this.checkBackpressure();
    return result;
  }

  /** Peek at buffered data without consuming. */
  peek(count?: number): Uint8Array {
    return this.ring.peek(count);
  }

  /** Number of bytes available to read. */
  get available(): number {
    return this.ring.available;
  }

  /** Buffer capacity in bytes. */
  get capacity(): number {
    return this.ring.capacity;
  }

  /** Current utilization as a fraction [0, 1]. */
  get utilization(): number {
    return this.ring.utilization;
  }

  /** Whether backpressure is currently active. */
  get isBackpressured(): boolean {
    return this.backpressureActive;
  }

  /** Clear all data and reset backpressure state. */
  clear(): void {
    this.ring.clear();
    if (this.backpressureActive) {
      this.backpressureActive = false;
      this.emitBackpressureOff();
    }
  }

  /**
   * Get cumulative buffer statistics.
   */
  getStats(): BufferStats {
    return {
      totalWritten: this._totalWritten,
      totalDropped: this._totalDropped,
      overflowEvents: this._overflowEvents,
      capacity: this.ring.capacity,
      currentSize: this.ring.available,
      utilization: this.ring.utilization,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private checkBackpressure(): void {
    const util = this.ring.utilization;

    if (!this.backpressureActive && util >= this.backpressureThreshold) {
      this.backpressureActive = true;
      this.emitBackpressureOn(util);
    } else if (this.backpressureActive && util <= this.hysteresisLow) {
      this.backpressureActive = false;
      this.emitBackpressureOff();
    }
  }

  private emitBackpressureOn(utilization: number): void {
    emitPtyEvent(this.bus, "pty.backpressure.on" as const, this.correlation, {
      ptyId: this.correlation.ptyId,
      laneId: this.correlation.laneId,
      utilization,
      threshold: this.backpressureThreshold,
    });
  }

  private emitBackpressureOff(): void {
    const utilization = this.ring.utilization;
    emitPtyEvent(this.bus, "pty.backpressure.off" as const, this.correlation, {
      ptyId: this.correlation.ptyId,
      laneId: this.correlation.laneId,
      utilization,
      threshold: this.backpressureThreshold,
    });
  }

  private handleOverflow(droppedBytes: number): void {
    // Log warning on first overflow.
    if (!this.firstOverflowLogged) {
      this.firstOverflowLogged = true;
      console.warn(
        // intentional overflow warning
        `[OutputBuffer] overflow: ${droppedBytes} bytes dropped for pty ${this.correlation.ptyId}`
      );
    }

    // Debounce overflow events: max 1 per overflowDebounceMs per PTY.
    const now = Date.now();
    if (now - this.lastOverflowEventTs >= this.overflowDebounceMs) {
      this.lastOverflowEventTs = now;
      this._overflowEvents++;

      emitPtyEvent(this.bus, "pty.buffer.overflow" as const, this.correlation, {
        ptyId: this.correlation.ptyId,
        laneId: this.correlation.laneId,
        droppedBytes,
        totalWritten: this._totalWritten,
        totalDropped: this._totalDropped,
        overflowEvents: this._overflowEvents,
        utilization: this.ring.utilization,
      });
    }
  }
}
