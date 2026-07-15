import { describe, it, expect, beforeEach } from "bun:test";
import { ReplayController, ReplayEngine } from "../../../src/audit/replay";
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
    const startTime = new Date("2026-03-01T10:00:00Z");
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

    it("reconstructs terminal output after the nearest snapshot", () => {
      const outputEvent = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.TERMINAL_OUTPUT,
        actor: "agent-1",
        action: "output",
        target: "terminal-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-1",
        sessionId: "session-1",
        correlationId: "corr-output",
        metadata: { data: "\nhello", cursorPosition: { row: 1, col: 5 } },
      });
      outputEvent.timestamp = "2026-03-01T10:10:00.000Z";
      mockStream.events = [outputEvent];

      const state = engine.getStateAtTime(mockStream, new Date("2026-03-01T10:20:00.000Z"));

      expect(state.terminalBuffer).toBe("Initial terminal state\nhello");
      expect(state.cursorPosition).toEqual({ row: 1, col: 5 });
    });
  });

  describe("loadSession", () => {
    it("loads, filters, and orders real snapshot/event sources", async () => {
      const otherSnapshot = { ...mockStream.snapshots[0]!, sessionId: "other" };
      const event = { ...mockStream.events[0]!, timestamp: "2026-03-01T10:30:00.000Z" };
      const stream = await engine.loadSession("session-1", {
        getSnapshots: () => [otherSnapshot, mockStream.snapshots[0]!],
        getEvents: () => [{ ...event, sessionId: "other" }, event],
      });

      expect(stream.snapshots).toHaveLength(1);
      expect(stream.events).toHaveLength(1);
      expect(stream.startTime.toISOString()).toBe("2026-03-01T10:00:00.000Z");
      expect(stream.endTime.toISOString()).toBe("2026-03-01T10:30:00.000Z");
      expect(stream.duration).toBe(30 * 60 * 1000);
    });
  });

  describe("ReplayController", () => {
    it("supports scrubbing, play/pause, and bounded speed controls", () => {
      const controller = new ReplayController(engine, mockStream);

      controller.seek(10_000);
      expect(controller.getPosition()).toBe(10_000);
      controller.setSpeed(2);
      controller.play();
      controller.advance(5_000);
      expect(controller.getPosition()).toBe(20_000);
      expect(controller.isPlaying()).toBe(true);
      controller.pause();
      controller.advance(5_000);
      expect(controller.getPosition()).toBe(20_000);
      expect(controller.getSpeed()).toBe(2);
      expect(() => controller.setSpeed(5)).toThrow(RangeError);
    });

    it("clamps seeks and pauses automatically at the end", () => {
      const controller = new ReplayController(engine, mockStream);
      controller.play();
      controller.advance(mockStream.duration + 1);

      expect(controller.getPosition()).toBe(mockStream.duration);
      expect(controller.isPlaying()).toBe(false);
    });
  });

  describe("getTimeline", () => {
    it("should return timeline entries for significant events", () => {
      const timeline = engine.getTimeline(mockStream);

      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline[0]!.eventType).toBe(AUDIT_EVENT_TYPES.COMMAND_EXECUTED);
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
