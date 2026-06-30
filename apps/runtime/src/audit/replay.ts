import type { AuditEvent } from "./event";
import type { SessionSnapshot } from "./snapshot";

/**
 * Timeline entry for significant events.
 */
export interface TimelineEntry {
  timestamp: Date;
  label: string;
  eventType: string;
}

/**
 * Complete replay stream for a session.
 */
export interface ReplayStream {
  sessionId: string;
  snapshots: SessionSnapshot[];
  events: AuditEvent[];
  startTime: Date;
  endTime: Date;
  duration: number;
}

/**
 * Session replay engine for historical terminal reconstruction.
 */
export class ReplayEngine {
  private stateCache: Map<string, SessionSnapshot> = new Map();

  /**
   * Load all snapshots and events for a session.
   *
   * @param sessionId - Session to load
   * @param store - Audit store for queries
   * @returns ReplayStream with snapshots and events
   */
  async loadSession(sessionId: string, _store: any): Promise<ReplayStream> {
    // TODO: Integrate with actual store queries
    // For now, return empty replay stream
    const _startTime = new Date();
    const endTime = new Date();

    return {
      sessionId,
      snapshots: [],
      events: [],
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
    };
  }

  /**
   * Get terminal state at a specific timestamp by applying events to the nearest snapshot.
   *
   * @param stream - Replay stream
   * @param timestamp - Target timestamp
   * @returns Session snapshot representing state at timestamp
   */
  getStateAtTime(stream: ReplayStream, timestamp: Date): SessionSnapshot {
    const cacheKey = timestamp.toISOString();

    if (this.stateCache.has(cacheKey)) {
      return this.stateCache.get(cacheKey)!;
    }

    // Find nearest snapshot before timestamp
    let baseSnapshot: SessionSnapshot | null = null;

    for (const snapshot of stream.snapshots) {
      const snapshotTime = new Date(snapshot.timestamp);
      if (snapshotTime <= timestamp) {
        baseSnapshot = snapshot;
      } else {
        break;
      }
    }

    // If no snapshot found, use first snapshot or create empty
    if (!baseSnapshot && stream.snapshots.length > 0) {
      baseSnapshot = stream.snapshots[0];
    }

    // Create a copy of the base snapshot
    const state: SessionSnapshot = baseSnapshot
      ? { ...baseSnapshot }
      : {
          id: "virtual",
          sessionId: stream.sessionId,
          timestamp: timestamp.toISOString(),
          terminalBuffer: "",
          cursorPosition: { row: 0, col: 0 },
          dimensions: { rows: 24, cols: 80 },
          scrollbackPosition: 0,
        };

    // Apply events between base snapshot and target timestamp
    for (const event of stream.events) {
      const eventTime = new Date(event.timestamp);
      if (eventTime > timestamp) {
        break;
      }

      // TODO: Apply event to state reconstruction
      // For now, just update timestamp
      state.timestamp = event.timestamp;
    }

    this.stateCache.set(cacheKey, state);

    return state;
  }

  /**
   * Get timeline entries for significant events.
   *
   * @param stream - Replay stream
   * @returns Array of timeline entries
   */
  getTimeline(stream: ReplayStream): TimelineEntry[] {
    const entries: TimelineEntry[] = [];

    // Add significant events (commands, errors, approvals)
    for (const event of stream.events) {
      if (
        ["command.executed", "policy.evaluation", "approval.resolved"].includes(
          event.eventType as any
        )
      ) {
        entries.push({
          timestamp: new Date(event.timestamp),
          label: `${event.action}: ${event.target}`,
          eventType: event.eventType,
        });
      }
    }

    return entries;
  }

  /**
   * Clear the state cache.
   */
  clearCache(): void {
    this.stateCache.clear();
  }
}
