/**
 * Ghostty input passthrough (T007).
 *
 * Relays user keystrokes from the ghostty renderer to the correct PTY
 * write path with minimal latency.  Input bytes are passed through
 * unmodified (raw bytes, not key names) to preserve terminal escape
 * sequences, modifier keys, and special keys.
 *
 * Design goals:
 * - Zero-copy / minimal-copy relay.
 * - No buffering or batching.
 * - Per-event latency measured for NFR-011-001.
 */

import type { GhosttyProcess } from "./process.js";
import type { GhosttyMetrics } from "./metrics.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal PTY write interface.
 * Consumers provide an object that can write raw bytes to a PTY.
 */
export interface PtyWriter {
  writeInput(ptyId: string, data: Uint8Array): void;
}

/**
 * Input event received from the ghostty process.
 */
export interface GhosttyInputEvent {
  /** Raw input bytes (escape sequences, modifiers already encoded). */
  data: Uint8Array;
  /** High-resolution timestamp when the event was received. */
  timestamp: number;
}

/**
 * Listener callback for ghostty input events.
 */
export type InputEventListener = (event: GhosttyInputEvent) => void;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InputRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputRelayError";
  }
}

// ---------------------------------------------------------------------------
// Input relay
// ---------------------------------------------------------------------------

interface RelayBinding {
  ptyId: string;
  listener: InputEventListener;
  teardown: (() => void) | undefined;
}

/**
 * Manages input relay bindings between ghostty and PTYs.
 *
 * Each binding listens for input events from the ghostty process
 * (scoped to a PTY / pane) and forwards raw bytes to the PTY writer.
 */
export class GhosttyInputRelay {
  private readonly _bindings = new Map<string, RelayBinding>();
  private readonly _ptyWriter: PtyWriter;
  private readonly _metrics: GhosttyMetrics | undefined;
  private _focusedPtyId: string | undefined;

  constructor(ptyWriter: PtyWriter, metrics?: GhosttyMetrics | undefined) {
    this._ptyWriter = ptyWriter;
    this._metrics = metrics;
  }

  // -----------------------------------------------------------------------
  // Focus management
  // -----------------------------------------------------------------------

  /**
   * Set the currently focused PTY.  Input events will be routed to this PTY.
   */
  setFocus(ptyId: string): void {
    this._focusedPtyId = ptyId;
  }

  /**
   * Clear focus.  While unfocused, input events are discarded.
   */
  clearFocus(): void {
    this._focusedPtyId = undefined;
  }

  /**
   * Return the currently focused PTY id, or undefined.
   */
  getFocusedPtyId(): string | undefined {
    return this._focusedPtyId;
  }

  // -----------------------------------------------------------------------
  // Setup / teardown
  // -----------------------------------------------------------------------

  /**
   * Set up an input relay for the given PTY.
   *
   * Listens for input events from the ghostty process and forwards
   * them to the PTY writer when this PTY is focused.
   *
   * @param ptyId - The PTY to bind input for.
   * @param _ghosttyProcess - The ghostty process to listen on.
   */
  setupInputRelay(ptyId: string, _ghosttyProcess: GhosttyProcess): void {
    // If already bound, tear down first (replace semantics)
    if (this._bindings.has(ptyId)) {
      this.teardownInputRelay(ptyId);
    }

    const listener: InputEventListener = event => {
      this._handleInput(ptyId, event);
    };

    // In a real integration, we would subscribe to the ghostty process's
    // IPC input channel for this PTY.  The process would call our listener
    // whenever raw input bytes arrive.
    //
    // For now, store the binding so that `relayInput` can be called
    // externally (by the adapter or test harness).

    const binding: RelayBinding = {
      ptyId,
      listener,
      teardown: undefined,
    };

    this._bindings.set(ptyId, binding);
  }

  /**
   * Tear down the input relay for the given PTY.
   */
  teardownInputRelay(ptyId: string): void {
    const _binding = this._bindings.get(ptyId);
    if (binding === undefined) return;

    binding.teardown?.();
    this._bindings.delete(ptyId);

    // If the torn-down PTY was focused, clear focus
    if (this._focusedPtyId === ptyId) {
      this._focusedPtyId = undefined;
    }
  }

  /**
   * Relay an input event externally.
   *
   * This is the public entry point for input from the ghostty process.
   * Routes to the focused PTY if one is set, or discards with a warning.
   *
   * @param event - Raw input event from ghostty.
   */
  relayInput(event: GhosttyInputEvent): void {
    if (this._focusedPtyId === undefined) {
      // No focused PTY: discard input
      console.warn("[ghostty/input] Input received but no PTY is focused; discarding.");
      return;
    }

    const _binding = this._bindings.get(this._focusedPtyId);
    if (binding === undefined) {
      console.warn(
        `[ghostty/input] Focused PTY "${this._focusedPtyId}" has no input relay binding; discarding.`
      );
      return;
    }

    binding.listener(event);
  }

  /**
   * Whether a binding exists for the given PTY.
   */
  hasBinding(ptyId: string): boolean {
    return this._bindings.has(ptyId);
  }

  /**
   * Return all bound PTY ids.
   */
  getBoundPtyIds(): string[] {
    return [...this._bindings.keys()];
  }

  // -----------------------------------------------------------------------
  // Teardown all
  // -----------------------------------------------------------------------

  /**
   * Tear down all input relay bindings.
   */
  teardownAll(): void {
    for (const ptyId of this._bindings.keys()) {
      this.teardownInputRelay(ptyId);
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private _handleInput(ptyId: string, event: GhosttyInputEvent): void {
    // Only relay if this is the focused PTY
    if (this._focusedPtyId !== ptyId) {
      return;
    }

    const writeStart = Date.now();

    // Zero-copy pass-through: send raw bytes directly to the PTY
    this._ptyWriter.writeInput(ptyId, event.data);

    // Record input latency for metrics (input timestamp -> write timestamp)
    if (this._metrics !== undefined) {
      this._metrics.recordInputLatency(event.timestamp, writeStart);
    }
  }
}
