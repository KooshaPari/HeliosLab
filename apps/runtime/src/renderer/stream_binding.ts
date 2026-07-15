/**
 * PTY stream binding and switch buffering for the renderer adapter layer.
 *
 * StreamBindingManager connects PTY output streams to the active renderer.
 * SwitchBuffer captures output during renderer switches to prevent data loss.
 *
 * @see FR-010-005
 */

import type { RendererAdapter } from "./adapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Record of a single stream binding. */
export interface StreamBinding {
  ptyId: string;
  stream: ReadableStream<Uint8Array>;
  renderer: RendererAdapter;
  boundAt: number;
  bytesRelayed: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface BufferOverflowEvent {
  type: "renderer.switch.buffer_overflow";
  ptyId: string;
  droppedBytes: number;
  timestamp: number;
}

export interface StreamBindingEventBus {
  publish(event: BufferOverflowEvent): void;
}

// ---------------------------------------------------------------------------
// StreamBindingManager
// ---------------------------------------------------------------------------

/**
 * Manages PTY stream bindings to the active renderer.
 *
 * Connects PTY output streams to a renderer for frame production and
 * handles rebinding during renderer switches.
 */
export class StreamBindingManager {
  private readonly _bindings = new Map<string, StreamBinding>();
  private _relayLatencies = new Map<string, number>();

  /**
   * Bind a PTY stream to a renderer.
   *
   * If the PTY is already bound, the existing binding is replaced (with a
   * warning logged to console).
   *
   * @param ptyId    - Unique PTY identifier.
   * @param stream   - Readable byte stream from the PTY.
   * @param renderer - The renderer adapter to pipe output to.
   */
  bind(ptyId: string, stream: ReadableStream<Uint8Array>, renderer: RendererAdapter): void {
    if (this._bindings.has(ptyId)) {
      console.warn(`StreamBindingManager: replacing existing binding for PTY "${ptyId}"`);
      this.unbind(ptyId);
    }

    const binding: StreamBinding = {
      ptyId,
      stream,
      renderer,
      boundAt: Date.now(),
      bytesRelayed: 0,
    };

    this._bindings.set(ptyId, binding);

    // Pipe stream to renderer
    const startRelay = performance.now();
    renderer.bindStream(ptyId, stream);
    this._relayLatencies.set(ptyId, performance.now() - startRelay);
  }

  /**
   * Unbind a PTY stream from its renderer.
   *
   * Does NOT close the stream (PTY still owns it). No-op if the PTY is
   * not currently bound.
   *
   * @param ptyId - PTY identifier to unbind.
   */
  unbind(ptyId: string): void {
    const binding = this._bindings.get(ptyId);
    if (binding === undefined) {
      return; // no-op
    }

    binding.renderer.unbindStream(ptyId);
    this._bindings.delete(ptyId);
    this._relayLatencies.delete(ptyId);
  }

  /**
   * Rebind all current streams to a new renderer.
   *
   * Used during renderer switches. Unbinds all from the current renderer(s)
   * and binds them to the new one. No-op if there are zero bindings.
   *
   * @param newRenderer - The renderer to rebind all streams to.
   */
  rebindAll(newRenderer: RendererAdapter): void {
    if (this._bindings.size === 0) {
      return; // no-op
    }

    // Collect binding data before unbinding
    const entries: Array<{
      ptyId: string;
      stream: ReadableStream<Uint8Array>;
    }> = [];
    for (const [ptyId, binding] of this._bindings) {
      entries.push({ ptyId, stream: binding.stream });
      binding.renderer.unbindStream(ptyId);
    }

    // Clear all bindings
    this._bindings.clear();
    this._relayLatencies.clear();

    // Rebind all to new renderer
    for (const { ptyId, stream } of entries) {
      this.bind(ptyId, stream, newRenderer);
    }
  }

  /** Return all current bindings. */
  getBindings(): Map<string, StreamBinding> {
    return new Map(this._bindings);
  }

  /** Return the number of active bindings. */
  count(): number {
    return this._bindings.size;
  }

  /**
   * Get the last measured relay latency for a binding (ms).
   *
   * @param ptyId - PTY identifier.
   * @returns Latency in ms, or undefined if not measured.
   */
  getRelayLatency(ptyId: string): number | undefined {
    return this._relayLatencies.get(ptyId);
  }
}

// ---------------------------------------------------------------------------
// SwitchBuffer
// ---------------------------------------------------------------------------

/** Per-PTY buffer entry used during renderer switches. */
interface PtyBuffer {
  chunks: Uint8Array[];
  totalBytes: number;
  rejectedBytes: number;
}

/** Raised at drain time when a producer exceeded the bounded switch buffer. */
export class SwitchBufferBackpressureError extends Error {
  constructor(
    public readonly ptyId: string,
    public readonly rejectedBytes: number
  ) {
    super(`Switch buffer capacity exceeded for PTY "${ptyId}"; ${rejectedBytes} bytes require retry`);
    this.name = "SwitchBufferBackpressureError";
  }
}

/**
 * Buffers PTY output during renderer switches to prevent data loss.
 *
 * When buffering is active, output is captured instead of being sent to a
 * renderer. On flush, all buffered data is sent to the new renderer.
 *
 * Each PTY has an independent buffer with a bounded capacity (default 4 MB).
 * When capacity is exhausted, the incoming write is rejected and a
 * `renderer.switch.buffer_overflow` event is published. Accepted bytes are
 * never evicted; the producer must retain and retry rejected bytes.
 */
export class SwitchBuffer {
  private readonly _buffers = new Map<string, PtyBuffer>();
  private _buffering = false;
  private readonly _maxBytesPerPty: number;
  private readonly _eventBus: StreamBindingEventBus | undefined;
  private _backpressureError: SwitchBufferBackpressureError | undefined;

  /**
   * @param maxBytesPerPty - Maximum buffer capacity per PTY in bytes (default 4 MB).
   * @param eventBus       - Optional event bus for overflow notifications.
   */
  constructor(maxBytesPerPty: number = 4 * 1024 * 1024, eventBus?: StreamBindingEventBus) {
    this._maxBytesPerPty = maxBytesPerPty;
    this._eventBus = eventBus;
  }

  /** Whether the buffer is currently capturing data. */
  get isBuffering(): boolean {
    return this._buffering;
  }

  /**
   * Start buffering all PTY output instead of sending to a renderer.
   */
  startBuffering(): void {
    this._buffering = true;
    this._buffers.clear();
    this._backpressureError = undefined;
  }

  /**
   * Write data to the buffer for a specific PTY.
   *
   * Only captures data while buffering is active. If the buffer for a PTY
   * exceeds capacity, the write is rejected to apply explicit backpressure.
   *
   * @param ptyId - PTY identifier.
   * @param data  - Output data to buffer.
   * @returns true when accepted; false when inactive or backpressured.
   */
  write(ptyId: string, data: Uint8Array): boolean {
    if (!this._buffering) {
      return false;
    }

    let buf = this._buffers.get(ptyId);
    if (buf === undefined) {
      buf = { chunks: [], totalBytes: 0, rejectedBytes: 0 };
      this._buffers.set(ptyId, buf);
    }

    if (buf.totalBytes + data.byteLength > this._maxBytesPerPty) {
      buf.rejectedBytes += data.byteLength;
      this._backpressureError = new SwitchBufferBackpressureError(ptyId, buf.rejectedBytes);
      this._eventBus?.publish({
        type: "renderer.switch.buffer_overflow",
        ptyId,
        droppedBytes: buf.rejectedBytes,
        timestamp: Date.now(),
      });
      return false;
    }

    buf.chunks.push(data.slice());
    buf.totalBytes += data.byteLength;
    return true;
  }

  /**
   * Stop buffering and return accepted bytes without binding them.
   * Rejected writes are never discarded silently: normal drains fail so the
   * switch transaction can roll back and the producer can retry them.
   */
  drainBufferedData(allowRejected = false): Map<string, Uint8Array> {
    if (!this._buffering) {
      return new Map();
    }
    if (!allowRejected && this._backpressureError !== undefined) {
      throw this._backpressureError;
    }

    const drained = new Map<string, Uint8Array>();
    for (const [ptyId, buf] of this._buffers) {
      const merged = new Uint8Array(buf.totalBytes);
      let offset = 0;
      for (const chunk of buf.chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      drained.set(ptyId, merged);
    }
    this._buffering = false;
    this._buffers.clear();
    this._backpressureError = undefined;
    return drained;
  }

  /**
   * Stop buffering and flush all captured data to the new renderer.
   *
   * After flushing, normal piping is resumed and the internal buffers are
   * cleared. If there is no buffered data, this is a no-op beyond stopping
   * the buffering state.
   *
   * @param renderer - The new renderer to flush data to.
   */
  stopBuffering(renderer: RendererAdapter): void {
    const drained = this.drainBufferedData();
    for (const [ptyId, merged] of drained) {
      if (merged.byteLength > 0) {
        // Create a one-shot stream with the buffered data and bind it
        const bufferedStream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(merged);
            controller.close();
          },
        });
        renderer.bindStream(ptyId, bufferedStream);
      }
    }
  }

  /**
   * Get the total number of bytes currently buffered across all PTYs.
   */
  getBufferedBytes(): number {
    let total = 0;
    for (const buf of this._buffers.values()) {
      total += buf.totalBytes;
    }
    return total;
  }

  /**
   * Get the number of bytes rejected due to overflow for a specific PTY.
   *
   * @param ptyId - PTY identifier.
   * @returns Bytes dropped, or 0 if no data was dropped.
   */
  getDroppedBytes(ptyId: string): number {
    return this._buffers.get(ptyId)?.rejectedBytes ?? 0;
  }
}
