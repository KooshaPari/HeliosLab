/**
 * PTY I/O — write-input handler delivering bytes to PTY fd.
 *
 * Input is written directly to the PTY stdin with minimal latency.
 * No buffering or reordering occurs.
 *
 * @module
 */

import type { PtyRecord } from "./registry.js";
import type { PtyState } from "./state_machine.js";
import type { BusPublisher, PtyEventCorrelation } from "./events.js";
import { emitPtyEvent } from "./events.js";

/** Error thrown when a write targets a PTY in an invalid state. */
export class InvalidStateError extends Error {
  public readonly ptyId: string;
  public readonly currentState: PtyState;

  constructor(ptyId: string, currentState: PtyState) {
    super(
      `Cannot write to PTY '${ptyId}' in state '${currentState}' (must be active or throttled)`
    );
    this.name = "InvalidStateError";
    this.ptyId = ptyId;
    this.currentState = currentState;
  }
}

/** Writable states that accept input. */
const WRITABLE_STATES: ReadonlySet<PtyState> = new Set(["active", "throttled"]);

/** Map of ptyId -> Subprocess for tracking live processes. */
export type ProcessMap = Map<
  string,
  { readonly stdin: { write(data: Uint8Array | string): number } }
>;

/** Result of a write operation including latency. */
export interface WriteResult {
  readonly bytesWritten: number;
  readonly latencyMs: number;
}

/**
 * Write input bytes directly to a PTY's stdin fd.
 *
 * @param record - The PTY record to write to.
 * @param data - The bytes to write.
 * @param processMap - Map from ptyId to subprocess handle.
 * @param bus - Bus publisher for error events.
 * @param onError - Callback to transition PTY to errored state on write failure.
 * @returns Write result with bytes written and latency.
 * @throws {InvalidStateError} if the PTY is not in a writable state.
 */
export function writeInput(
  record: PtyRecord,
  data: Uint8Array,
  processMap: ProcessMap,
  bus: BusPublisher,
  onError?: (ptyId: string) => void
): WriteResult {
  const start = performance.now();

  // Zero-length writes are no-ops.
  if (data.length === 0) {
    return { bytesWritten: 0, latencyMs: performance.now() - start };
  }

  // Validate state.
  if (!WRITABLE_STATES.has(record.state)) {
    throw new InvalidStateError(record.ptyId, record.state);
  }

  const proc = processMap.get(record.ptyId);
  if (!proc) {
    throw new InvalidStateError(record.ptyId, record.state);
  }

  try {
    const written = proc.stdin.write(data);
    const latencyMs = performance.now() - start;
    return { bytesWritten: written, latencyMs };
  } catch {
    // Broken pipe or fd closed — publish diagnostic and trigger error transition.
    const correlation: PtyEventCorrelation = {
      ptyId: record.ptyId,
      laneId: record.laneId,
      sessionId: record.sessionId,
      terminalId: record.terminalId,
      correlationId: crypto.randomUUID(),
    };

    emitPtyEvent(bus, "pty.error", correlation, {
      error: error instanceof Error ? error.message : String(error),
      reason: "write_failed",
    });

    if (onError) {
      onError(record.ptyId);
    }

    throw error;
  }
}
