import { describe, it, expect } from "bun:test";
import {
  validateCheckpoint,
  CHECKPOINT_VERSION,
  type Checkpoint,
  type CheckpointSession,
} from "../checkpoint.js";

describe("Checkpoint Validation", () => {
  const createValidCheckpoint = (overrides?: Partial<Checkpoint>): Checkpoint => {
    return {
      version: CHECKPOINT_VERSION,
      timestamp: Date.now(),
      checksum: "abc123",
      sessions: [
        {
          sessionId: "sess-1",
          terminalId: "term-1",
          laneId: "lane-1",
          workingDirectory: "/home/user",
          environmentVariables: {},
          scrollbackSnapshot: "test",
          zelijjSessionName: "main",
          shellCommand: "bash",
        },
      ],
      ...overrides,
    };
  };

  describe("valid checkpoint", () => {
    it("should pass validation for valid checkpoint", () => {
      const _checkpoint = createValidCheckpoint();
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  describe("version validation", () => {
    it("should reject future schema version", () => {
      const _checkpoint = createValidCheckpoint({
        version: CHECKPOINT_VERSION + 1,
      });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === "version")).toBe(true);
    });

    it("should accept current schema version", () => {
      const _checkpoint = createValidCheckpoint({ version: CHECKPOINT_VERSION });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(true);
    });
  });

  describe("timestamp validation", () => {
    it("should reject timestamp in future (beyond tolerance)", () => {
      const futureTimestamp = Date.now() + 10 * 60 * 1000; // 10 minutes in future
      const _checkpoint = createValidCheckpoint({ timestamp: futureTimestamp });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === "timestamp")).toBe(true);
    });

    it("should accept timestamp within future tolerance", () => {
      const nearFutureTimestamp = Date.now() + 2 * 60 * 1000; // 2 minutes in future
      const _checkpoint = createValidCheckpoint({
        timestamp: nearFutureTimestamp,
      });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(true);
    });

    it("should reject timestamp older than max age", () => {
      const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours old
      const _checkpoint = createValidCheckpoint({ timestamp: oldTimestamp });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === "timestamp")).toBe(true);
    });

    it("should accept recent timestamp", () => {
      const recentTimestamp = Date.now() - 1 * 60 * 60 * 1000; // 1 hour old
      const _checkpoint = createValidCheckpoint({ timestamp: recentTimestamp });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(true);
    });
  });

  describe("session validation", () => {
    it("should reject session missing sessionId", () => {
      const _checkpoint = createValidCheckpoint({
        sessions: [
          {
            sessionId: "",
            terminalId: "term-1",
            laneId: "lane-1",
            workingDirectory: "/home/user",
            environmentVariables: {},
            scrollbackSnapshot: "test",
            zelijjSessionName: "main",
            shellCommand: "bash",
          },
        ],
      });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === "sessionId")).toBe(true);
    });

    it("should reject session missing terminalId", () => {
      const _checkpoint = createValidCheckpoint({
        sessions: [
          {
            sessionId: "sess-1",
            terminalId: "",
            laneId: "lane-1",
            workingDirectory: "/home/user",
            environmentVariables: {},
            scrollbackSnapshot: "test",
            zelijjSessionName: "main",
            shellCommand: "bash",
          },
        ],
      });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === "terminalId")).toBe(true);
    });

    it("should reject session missing laneId", () => {
      const _checkpoint = createValidCheckpoint({
        sessions: [
          {
            sessionId: "sess-1",
            terminalId: "term-1",
            laneId: "",
            workingDirectory: "/home/user",
            environmentVariables: {},
            scrollbackSnapshot: "test",
            zelijjSessionName: "main",
            shellCommand: "bash",
          },
        ],
      });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === "laneId")).toBe(true);
    });

    it("should reject session missing workingDirectory", () => {
      const _checkpoint = createValidCheckpoint({
        sessions: [
          {
            sessionId: "sess-1",
            terminalId: "term-1",
            laneId: "lane-1",
            workingDirectory: "",
            environmentVariables: {},
            scrollbackSnapshot: "test",
            zelijjSessionName: "main",
            shellCommand: "bash",
          },
        ],
      });
      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === "workingDirectory")).toBe(true);
    });
  });

  describe("per-session validation", () => {
    it("should report errors with sessionId for specific sessions", () => {
      const validSession: CheckpointSession = {
        sessionId: "sess-1",
        terminalId: "term-1",
        laneId: "lane-1",
        workingDirectory: "/home/user",
        environmentVariables: {},
        scrollbackSnapshot: "test",
        zelijjSessionName: "main",
        shellCommand: "bash",
      };

      const invalidSession: CheckpointSession = {
        sessionId: "sess-2",
        terminalId: "",
        laneId: "lane-2",
        workingDirectory: "/home/user",
        environmentVariables: {},
        scrollbackSnapshot: "test",
        zelijjSessionName: "main",
        shellCommand: "bash",
      };

      const _checkpoint = createValidCheckpoint({
        sessions: [validSession, invalidSession],
      });

      const result = validateCheckpoint(checkpoint);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.sessionId === "sess-2")).toBe(true);
    });

    it("should allow partial validity", () => {
      const _checkpoint = createValidCheckpoint({
        sessions: [
          {
            sessionId: "sess-1",
            terminalId: "term-1",
            laneId: "lane-1",
            workingDirectory: "/home/user",
            environmentVariables: {},
            scrollbackSnapshot: "test",
            zelijjSessionName: "main",
            shellCommand: "bash",
          },
          {
            sessionId: "sess-2",
            terminalId: "",
            laneId: "lane-2",
            workingDirectory: "/home/user",
            environmentVariables: {},
            scrollbackSnapshot: "test",
            zelijjSessionName: "main",
            shellCommand: "bash",
          },
        ],
      });

      const result = validateCheckpoint(checkpoint);

      // Should have errors for second session, but overall valid flag depends on if we want partial validation
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
