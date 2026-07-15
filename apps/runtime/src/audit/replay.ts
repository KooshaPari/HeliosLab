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

export interface ReplayStore {
  getSnapshots(sessionId: string): Promise<SessionSnapshot[]> | SessionSnapshot[];
  getEvents(sessionId: string): Promise<AuditEvent[]> | AuditEvent[];
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
  async loadSession(sessionId: string, store: ReplayStore): Promise<ReplayStream> {
    const snapshots = (await store.getSnapshots(sessionId))
      .filter(snapshot => snapshot.sessionId === sessionId)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const events = (await store.getEvents(sessionId))
      .filter(event => event.sessionId === sessionId)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const timestamps = [
      ...snapshots.map(snapshot => Date.parse(snapshot.timestamp)),
      ...events.map(event => Date.parse(event.timestamp)),
    ].filter(Number.isFinite);
    const startTime = new Date(timestamps.length > 0 ? Math.min(...timestamps) : Date.now());
    const endTime = new Date(timestamps.length > 0 ? Math.max(...timestamps) : startTime.getTime());

    return {
      sessionId,
      snapshots,
      events,
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
    const cacheKey = `${stream.sessionId}:${timestamp.toISOString()}`;

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
      baseSnapshot = stream.snapshots[0]!;
    }

    // Create a copy of the base snapshot
    const state: SessionSnapshot = baseSnapshot
      ? {
          ...baseSnapshot,
          cursorPosition: { ...baseSnapshot.cursorPosition },
          dimensions: { ...baseSnapshot.dimensions },
        }
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
      if (baseSnapshot !== null && eventTime <= new Date(baseSnapshot.timestamp)) {
        continue;
      }

      if (event.eventType === "terminal.output") {
        const output = event.metadata["data"];
        if (typeof output === "string") {
          state.terminalBuffer += output;
        }
      }
      const cursor = event.metadata["cursorPosition"];
      if (
        typeof cursor === "object" &&
        cursor !== null &&
        typeof (cursor as Record<string, unknown>)["row"] === "number" &&
        typeof (cursor as Record<string, unknown>)["col"] === "number"
      ) {
        state.cursorPosition = {
          row: (cursor as Record<string, number>)["row"]!,
          col: (cursor as Record<string, number>)["col"]!,
        };
      }
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

/** UI-facing deterministic playback adapter; the view supplies animation-frame deltas. */
export class ReplayController {
  private positionMs = 0;
  private playing = false;
  private speed = 1;

  constructor(
    private readonly engine: ReplayEngine,
    private readonly stream: ReplayStream
  ) {}

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
      throw new RangeError("Replay speed must be between 0.25x and 4x");
    }
    this.speed = speed;
  }

  getSpeed(): number {
    return this.speed;
  }

  seek(positionMs: number): SessionSnapshot {
    this.positionMs = Math.max(0, Math.min(positionMs, this.stream.duration));
    return this.currentState();
  }

  advance(elapsedMs: number): SessionSnapshot {
    if (this.playing) {
      this.seek(this.positionMs + Math.max(0, elapsedMs) * this.speed);
      if (this.positionMs >= this.stream.duration) {
        this.pause();
      }
    }
    return this.currentState();
  }

  getPosition(): number {
    return this.positionMs;
  }

  currentState(): SessionSnapshot {
    return this.engine.getStateAtTime(
      this.stream,
      new Date(this.stream.startTime.getTime() + this.positionMs)
    );
  }
}
