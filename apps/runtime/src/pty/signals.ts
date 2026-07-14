/**
 * PTY signal handling — resize, terminate, and signal delivery with audit records.
 *
 * All signal deliveries produce auditable {@link SignalEnvelope} records
 * published to the local bus.
 *
 * @module
 */

import type { PtyRecord } from "./registry.js";
import { PtyRegistry } from "./registry.js";
import { PtyLifecycle } from "./state_machine.js";
import type { BusPublisher, PtyEventCorrelation } from "./events.js";
import { emitPtyEvent } from "./events.js";

// ── Signal Envelope ──────────────────────────────────────────────────────────

/** Auditable record of a signal delivery. */
export interface SignalEnvelope {
  readonly ptyId: string;
  readonly signal: string;
  readonly timestamp: number;
  readonly outcome: "delivered" | "failed" | "escalated";
  readonly pid: number;
  readonly error?: string;
}

/** Per-PTY bounded signal history. */
export class SignalHistory {
  private readonly records: SignalEnvelope[] = [];
  private readonly maxRecords: number;

  constructor(maxRecords = 50) {
    this.maxRecords = maxRecords;
  }

  add(envelope: SignalEnvelope): void {
    this.records.push(envelope);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
  }

  getAll(): readonly SignalEnvelope[] {
    return this.records;
  }

  get length(): number {
    return this.records.length;
  }
}

/** Map from ptyId to signal history. */
export type SignalHistoryMap = Map<string, SignalHistory>;

/**
 * Record a signal delivery and publish it to the bus.
 */
function recordSignal(
  envelope: SignalEnvelope,
  historyMap: SignalHistoryMap,
  bus: BusPublisher,
  correlation: PtyEventCorrelation
): void {
  let history = historyMap.get(envelope.ptyId);
  if (!history) {
    history = new SignalHistory();
    historyMap.set(envelope.ptyId, history);
  }
  history.add(envelope);

  emitPtyEvent(bus, "pty.signal.delivered", correlation, {
    signal: envelope.signal,
    outcome: envelope.outcome,
    pid: envelope.pid,
    error: envelope.error,
  });
}

/**
 * Deliver a POSIX signal to a process and record the outcome.
 */
function deliverSignal(
  pid: number,
  signal: string,
  ptyId: string,
  historyMap: SignalHistoryMap,
  bus: BusPublisher,
  correlation: PtyEventCorrelation
): SignalEnvelope {
  const timestamp = Date.now();
  try {
    process.kill(pid, signal);
    const envelope: SignalEnvelope = {
      ptyId,
      signal,
      timestamp,
      outcome: "delivered",
      pid,
    };
    recordSignal(envelope, historyMap, bus, correlation);
    return envelope;
  } catch {
    const envelope: SignalEnvelope = {
      ptyId,
      signal,
      timestamp,
      outcome: "failed",
      pid,
      error: error instanceof Error ? error.message : String(error),
    };
    recordSignal(envelope, historyMap, bus, correlation);
    return envelope;
  }
}

// ── Resize ───────────────────────────────────────────────────────────────────

/** Error thrown when resize dimensions are invalid. */
export class InvalidDimensionsError extends Error {
  constructor(cols: number, rows: number) {
    super(`Invalid PTY dimensions: cols=${cols}, rows=${rows} (must be 1..10000)`);
    this.name = "InvalidDimensionsError";
  }
}

/**
 * Resize a PTY: update dimensions, deliver SIGWINCH, publish event.
 *
 * @param record - The PTY record.
 * @param cols - New column count (1..10000).
 * @param rows - New row count (1..10000).
 * @param registry - The PTY registry.
 * @param historyMap - Signal history map.
 * @param bus - Bus publisher.
 * @throws {InvalidDimensionsError} if dimensions are out of range.
 * @throws {Error} if PTY is in errored or stopped state.
 */
export function resize(
  record: PtyRecord,
  cols: number,
  rows: number,
  registry: PtyRegistry,
  historyMap: SignalHistoryMap,
  bus: BusPublisher
): void {
  // Reject resize on errored/stopped PTYs.
  if (record.state === "errored" || record.state === "stopped") {
    throw new Error(`Cannot resize PTY '${record.ptyId}' in state '${record.state}'`);
  }

  // Validate dimensions.
  if (cols < 1 || cols > 10000 || rows < 1 || rows > 10000) {
    throw new InvalidDimensionsError(cols, rows);
  }
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    throw new InvalidDimensionsError(cols, rows);
  }

  const oldDimensions = { ...record.dimensions };

  // Update registry dimensions.
  registry.update(record.ptyId, { dimensions: { cols, rows } });

  const correlation: PtyEventCorrelation = {
    ptyId: record.ptyId,
    laneId: record.laneId,
    sessionId: record.sessionId,
    terminalId: record.terminalId,
    correlationId: crypto.randomUUID(),
  };

  // Deliver SIGWINCH to child process.
  deliverSignal(record.pid, "SIGWINCH", record.ptyId, historyMap, bus, correlation);

  // Publish resize event.
  emitPtyEvent(bus, "pty.resized", correlation, {
    oldDimensions,
    newDimensions: { cols, rows },
  });
}

// ── Terminate ────────────────────────────────────────────────────────────────

/** Options for the terminate operation. */
export interface TerminateOptions {
  /** Grace period in ms before escalating SIGTERM to SIGKILL (default: 5000). */
  gracePeriodMs?: number;
}

/**
 * Terminate a PTY process with SIGTERM-to-SIGKILL escalation.
 *
 * Termination sequence:
 * 1. Send SIGTERM
 * 2. Wait up to gracePeriodMs for exit
 * 3. If still alive, send SIGKILL
 * 4. Wait up to 1s additional
 * 5. Clean up registry
 *
 * Idempotent: calling on an already-stopped PTY is a no-op.
 *
 * @param record - The PTY record.
 * @param lifecycle - The PTY lifecycle state machine.
 * @param registry - The PTY registry.
 * @param historyMap - Signal history map.
 * @param bus - Bus publisher.
 * @param options - Termination options.
 * @param isAlive - Function to check if process is still alive (default: kill -0).
 * @param waitForExit - Function to wait for process exit (for testability).
 */
export async function terminate(
  record: PtyRecord,
  lifecycle: PtyLifecycle,
  registry: PtyRegistry,
  historyMap: SignalHistoryMap,
  bus: BusPublisher,
  options?: TerminateOptions,
  isAlive?: (pid: number) => boolean,
  waitForExit?: (pid: number, timeoutMs: number) => Promise<boolean>
): Promise<void> {
  const gracePeriodMs = options?.gracePeriodMs ?? 5000;

  // Idempotent: already stopped.
  if (record.state === "stopped") {
    return;
  }

  const correlation: PtyEventCorrelation = {
    ptyId: record.ptyId,
    laneId: record.laneId,
    sessionId: record.sessionId,
    terminalId: record.terminalId,
    correlationId: crypto.randomUUID(),
  };

  const checkAlive =
    isAlive ??
    ((pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

  const defaultWaitForExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!checkAlive(pid)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return !checkAlive(pid);
  };

  const waitFn = waitForExit ?? defaultWaitForExit;

  // Publish pty.terminating event.
  emitPtyEvent(bus, "pty.terminating", correlation, {
    gracePeriodMs,
  });

  // Step 1: Send SIGTERM.
  const _termEnvelope = deliverSignal(
    record.pid,
    "SIGTERM",
    record.ptyId,
    historyMap,
    bus,
    correlation
  );

  // Step 2: Wait for exit within grace period.
  const exited = await waitFn(record.pid, gracePeriodMs);

  if (!exited) {
    // Step 3: Escalate to SIGKILL.
    const killEnvelope: SignalEnvelope = {
      ptyId: record.ptyId,
      signal: "SIGKILL",
      timestamp: Date.now(),
      outcome: "escalated",
      pid: record.pid,
    };
    recordSignal(killEnvelope, historyMap, bus, correlation);

    deliverSignal(record.pid, "SIGKILL", record.ptyId, historyMap, bus, correlation);

    emitPtyEvent(bus, "pty.force_killed", correlation, {
      reason: "grace_period_expired",
      gracePeriodMs,
    });

    // Step 4: Wait up to 1s for SIGKILL to take effect.
    await waitFn(record.pid, 1000);
  }

  // Step 5: Transition to stopped and clean up.
  try {
    if (lifecycle.state === "active") {
      lifecycle.apply("graceful_terminate");
    } else if (lifecycle.state === "throttled") {
      lifecycle.apply("terminate");
    } else if (lifecycle.state === "errored") {
      lifecycle.apply("cleanup");
    }
    // spawning or idle — don't have a direct terminate transition,
    // but we still clean up the registry.
  } catch {
    // State transition failed — clean up anyway.
  }

  registry.update(record.ptyId, { state: "stopped" });
  registry.remove(record.ptyId);

  // Clean up signal history.
  historyMap.delete(record.ptyId);

  // Publish stopped event.
  emitPtyEvent(bus, "pty.stopped", correlation, {
    exitReason: exited ? "sigterm" : "sigkill_escalation",
  });
}

// ── SIGHUP delivery ──────────────────────────────────────────────────────────

/**
 * Send SIGHUP to a PTY child process and record the delivery.
 */
export function sendSighup(
  record: PtyRecord,
  historyMap: SignalHistoryMap,
  bus: BusPublisher
): SignalEnvelope {
  const correlation: PtyEventCorrelation = {
    ptyId: record.ptyId,
    laneId: record.laneId,
    sessionId: record.sessionId,
    terminalId: record.terminalId,
    correlationId: crypto.randomUUID(),
  };

  return deliverSignal(record.pid, "SIGHUP", record.ptyId, historyMap, bus, correlation);
}
