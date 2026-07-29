/**
 * Rio input passthrough — relays user input from rio back to PTYs.
 *
 * Raw bytes are forwarded without modification or buffering, matching
 * the ghostty input passthrough pattern (spec 011 WP02 T007).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PtyWriteSink {
  writeInput(ptyId: string, data: Uint8Array): void;
}

// ---------------------------------------------------------------------------
// Input relay
// ---------------------------------------------------------------------------

export class RioInputRelay {
  private _sink: PtyWriteSink | undefined;
  private _focusedPtyId: string | undefined;
  private _latencySamples: number[] = [];
  private static readonly MAX_LATENCY_SAMPLES = 100;

  /**
   * Set the PTY write sink (typically the ptyManager).
   */
  setSink(sink: PtyWriteSink): void {
    this._sink = sink;
  }

  /**
   * Set the currently focused PTY (for routing input).
   */
  setFocusedPty(ptyId: string | undefined): void {
    this._focusedPtyId = ptyId;
  }

  /**
   * Relay raw input bytes to the focused PTY.
   *
   * No buffering, no batching. Raw bytes forwarded immediately.
   * If no PTY is focused, the input is discarded with a warning.
   */
  relay(ptyId: string, data: Uint8Array): void {
    const startNs = performance.now();

    const targetPty = ptyId || this._focusedPtyId;
    if (!targetPty) {
      console.warn("Rio input relay: no focused PTY, discarding input");
      return;
    }

    if (this._sink) {
      this._sink.writeInput(targetPty, data);
    }

    // Measure latency.
    const elapsed = performance.now() - startNs;
    this._latencySamples.push(elapsed);
    if (this._latencySamples.length > RioInputRelay.MAX_LATENCY_SAMPLES) {
      this._latencySamples.shift();
    }
  }

  /**
   * Get the average input-to-PTY-write latency in ms.
   */
  getAverageLatencyMs(): number {
    if (this._latencySamples.length === 0) return 0;
    const sum = this._latencySamples.reduce((a, b) => a + b, 0);
    return sum / this._latencySamples.length;
  }

  /**
   * Get all latency samples (for testing / export).
   */
  getLatencySamples(): readonly number[] {
    return this._latencySamples;
  }
}
