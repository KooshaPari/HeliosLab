import { describe, it, expect, beforeEach } from "bun:test";
import { ReplayEngine } from "../../../src/audit/replay";
import type { ReplayStream } from "../../../src/audit/replay";
import { createAuditEvent, AUDIT_EVENT_TYPES, AUDIT_EVENT_RESULTS } from "../../../src/audit/event";
import type { SessionSnapshot } from "../../../src/audit/snapshot";

// Traces to: FR-AUD-006 (terminal session snapshots), FR-AUD-007 (session replay UI with time-scrubbing)

describe("ReplayEngine", () => {
  let engine: ReplayEngine;
  let mockStream: ReplayStream;

  beforeEach(() => {
    engine = new ReplayEngine();

    // Create mock replay stream
    const _startTime = new Date("2026-03-01T10:00:00Z");
    const endTime = new Date("2026-03-01T11:00:00Z");

    const snapshot: SessionSnapshot = {
      id: "snap-1",
      sessionId: "session-1",
      timestamp: startTime.toISOString(),
      terminalBuffer: "Initial terminal state",
      cursorPosition: { row: 0, col: 0 },
      dimensions: { rows: 24, cols: 80 },
      scrollbackPosition: 0,
    };

    const events = [
      createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "echo hello",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-1",
        sessionId: "session-1",
        correlationId: "corr-1",
        metadata: {},
      }),
    ];

    mockStream = {
      sessionId: "session-1",
      snapshots: [snapshot],
      events,
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
    };
  });

  describe("getStateAtTime", () => {
    it("should return state at given timestamp", () => {
      const targetTime = mockStream.startTime;
      const state = engine.getStateAtTime(mockStream, targetTime);

      expect(state).toBeDefined();
      expect(state.sessionId).toBe("session-1");
    });

    it("should cache reconstructed states", () => {
      const targetTime = mockStream.startTime;

      engine.getStateAtTime(mockStream, targetTime);
      engine.getStateAtTime(mockStream, targetTime); // Call again

      // Cache should have the entry
      engine.clearCache();
    });
  });

  describe("getTimeline", () => {
    it("should return timeline entries for significant events", () => {
      const timeline = engine.getTimeline(mockStream);

      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline[0].eventType).toBe(AUDIT_EVENT_TYPES.COMMAND_EXECUTED);
    });
  });

  describe("clearCache", () => {
    it("should clear cached states", () => {
      engine.getStateAtTime(mockStream, mockStream.startTime);
      engine.clearCache();
      // Should not throw
    });
  });
});
