/**
 * Session snapshot for replay reconstruction.
 */
export interface SessionSnapshot {
  id: string;
  sessionId: string;
  timestamp: string;
  terminalBuffer: string;
  cursorPosition: { row: number; col: number };
  dimensions: { rows: number; cols: number };
  scrollbackPosition: number;
}

export type TerminalSnapshotState = Omit<SessionSnapshot, "id" | "sessionId" | "timestamp">;

/** Supplies the current terminal state from the owning session runtime. */
export interface TerminalSnapshotSource {
  readTerminalState(sessionId: string): TerminalSnapshotState;
}

/**
 * Captures periodic snapshots of session terminal state for replay.
 */
export class SnapshotCapture {
  private timer: number | null = null;
  private isRunning = false;

  constructor(private readonly source: TerminalSnapshotSource) {}

  /**
   * Start capturing snapshots at configurable interval.
   *
   * @param sessionId - Session to capture
   * @param intervalMs - Capture interval in milliseconds (default 30000)
   * @param onSnapshot - Callback when snapshot captured
   */
  start(
    sessionId: string,
    intervalMs: number = 30_000,
    onSnapshot: (snapshot: SessionSnapshot) => void
  ): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    this.timer = setInterval(() => {
      this.captureNow(sessionId, onSnapshot);
    }, intervalMs) as unknown as number;

    // Capture immediately on start
    this.captureNow(sessionId, onSnapshot);
  }

  /**
   * Stop capturing snapshots.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.isRunning = false;
  }

  /**
   * Capture a snapshot immediately.
   */
  captureNow(sessionId: string, onSnapshot: (snapshot: SessionSnapshot) => void): void {
    try {
      const snapshot: SessionSnapshot = {
        id: `snap-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        sessionId,
        timestamp: new Date().toISOString(),
        ...this.source.readTerminalState(sessionId),
      };

      onSnapshot(snapshot);
    } catch (err) {
      console.error("[SnapshotCapture] Failed to capture snapshot:", err);
    }
  }

}
