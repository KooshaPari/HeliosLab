import { describe, expect, it } from "bun:test";
import { SnapshotCapture, type SessionSnapshot } from "../../../src/audit/snapshot";

const source = {
  readTerminalState: (sessionId: string) => ({
    terminalBuffer: `buffer:${sessionId}`,
    cursorPosition: { row: 7, col: 11 },
    dimensions: { rows: 40, cols: 120 },
    scrollbackPosition: 23,
  }),
};

describe("SnapshotCapture", () => {
  it("captures the current terminal state rather than a placeholder", () => {
    const capture = new SnapshotCapture(source);
    const snapshots: SessionSnapshot[] = [];

    capture.captureNow("session-1", snapshot => snapshots.push(snapshot));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      sessionId: "session-1",
      terminalBuffer: "buffer:session-1",
      cursorPosition: { row: 7, col: 11 },
      dimensions: { rows: 40, cols: 120 },
      scrollbackPosition: 23,
    });
  });

  it("captures immediately and at the configured interval until stopped", async () => {
    const capture = new SnapshotCapture(source);
    const snapshots: SessionSnapshot[] = [];
    capture.start("session-2", 10, snapshot => snapshots.push(snapshot));

    await new Promise(resolve => setTimeout(resolve, 35));
    capture.stop();
    const stoppedCount = snapshots.length;
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(stoppedCount).toBeGreaterThanOrEqual(3);
    expect(snapshots).toHaveLength(stoppedCount);
    expect(snapshots.every(snapshot => snapshot.sessionId === "session-2")).toBe(true);
  });
});
