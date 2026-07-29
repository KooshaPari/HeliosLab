/**
 * PTY lifecycle event publishing — fire-and-forget bus integration.
 *
 * All events conform to the Helios Local Bus v1 envelope schema.
 * Bus failures never block PTY operations.
 *
 * @module
 */

/** Correlation fields included in every PTY event. */
export interface PtyEventCorrelation {
  readonly ptyId: string;
  readonly laneId: string;
  readonly sessionId: string;
  readonly terminalId: string;
  readonly correlationId: string;
}

/** All PTY event topic strings. */
export type PtyEventTopic =
  | "pty.spawned"
  | "pty.state.changed"
  | "pty.output"
  | "pty.error"
  | "pty.stopped"
  | "pty.resized"
  | "pty.signal.delivered"
  | "pty.terminating"
  | "pty.force_killed"
  | "pty.idle_timeout"
  | "pty.backpressure.on"
  | "pty.backpressure.off"
  | "pty.buffer.overflow";

/** A bus envelope for PTY events. */
export interface PtyBusEvent {
  readonly id: string;
  readonly type: "event";
  readonly ts: string;
  readonly topic: PtyEventTopic;
  readonly workspace_id?: string;
  readonly session_id: string;
  readonly terminal_id: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Bus publisher interface — abstraction over the local bus.
 * Implementations must be fire-and-forget on the hot path.
 */
export interface BusPublisher {
  publish(event: PtyBusEvent): void;
}

/**
 * No-op bus publisher that silently drops events.
 * Used when no bus is configured or as a fallback.
 */
export class NoOpBusPublisher implements BusPublisher {
  publish(_event: PtyBusEvent): void {
    // Intentionally empty — fire-and-forget drop.
  }
}

/**
 * In-memory bus publisher that records events for testing.
 */
export class InMemoryBusPublisher implements BusPublisher {
  public readonly events: PtyBusEvent[] = [];

  publish(event: PtyBusEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }
}

/**
 * Build and publish a PTY lifecycle event. Bus failures are caught
 * and silently dropped so they never block PTY operations.
 */
export function emitPtyEvent(
  bus: BusPublisher,
  topic: PtyEventTopic,
  correlation: PtyEventCorrelation,
  payload: Record<string, unknown> = {}
): void {
  const event: PtyBusEvent = {
    id: crypto.randomUUID(),
    type: "event",
    ts: new Date().toISOString(),
    topic,
    session_id: correlation.sessionId,
    terminal_id: correlation.terminalId,
    payload: {
      ...payload,
      ptyId: correlation.ptyId,
      laneId: correlation.laneId,
      sessionId: correlation.sessionId,
      terminalId: correlation.terminalId,
      correlationId: correlation.correlationId,
    },
  };

  try {
    bus.publish(event);
  } catch {
    // Bus failure must not block PTY operations — drop silently.
  }
}
