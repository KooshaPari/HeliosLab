/**
 * FR-HELIOS-035: Binding Triple Validation Tests
 * Verifies: FR-BND-001 (Terminal registry mapping), FR-BND-002 (Binding validation), FR-BND-007 (Uniqueness)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  BindingState,
  type BindingTriple,
  createBinding,
  validateBindingTriple,
  type RegistryQueryInterface,
} from "../../../src/registry/binding_triple.js";

/**
 * Mock registry query interface for testing.
 */
class MockRegistryQuery implements RegistryQueryInterface {
  private workspaces = new Set<string>();
  private lanes = new Set<string>();
  private sessions = new Set<string>();
  private laneToWorkspace = new Map<string, string>();
  private sessionToLane = new Map<string, string>();

  addWorkspace(id: string) {
    this.workspaces.add(id);
  }

  addLane(id: string, workspaceId: string) {
    this.lanes.add(id);
    this.laneToWorkspace.set(id, workspaceId);
  }

  addSession(id: string, laneId: string) {
    this.sessions.add(id);
    this.sessionToLane.set(id, laneId);
  }

  workspaceExists(id: string): boolean {
    return this.workspaces.has(id);
  }

  laneExists(id: string): boolean {
    return this.lanes.has(id);
  }

  sessionExists(id: string): boolean {
    return this.sessions.has(id);
  }

  laneInWorkspace(laneId: string, workspaceId: string): boolean {
    return this.laneToWorkspace.get(laneId) === workspaceId;
  }

  sessionInLane(sessionId: string, laneId: string): boolean {
    return this.sessionToLane.get(sessionId) === laneId;
  }
}

describe("binding_triple", () => {
  describe("createBinding", () => {
    it("should create a binding with all required fields populated", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = createBinding("terminal-1", triple);

      expect(binding.terminalId).toBe("terminal-1");
      expect(binding.binding).toEqual(triple);
      expect(binding.state).toBe(BindingState.bound);
      expect(binding.createdAt).toBeGreaterThan(0);
      expect(binding.updatedAt).toBe(binding.createdAt);
    });

    it("should set timestamps to current time", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _before = Date.now();
      const _binding = createBinding("terminal-1", triple);
      const after = Date.now();

      expect(binding.createdAt).toBeGreaterThanOrEqual(before);
      expect(binding.createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe("validateBindingTriple", () => {
    let query: MockRegistryQuery;

    beforeEach(() => {
      query = new MockRegistryQuery();
      query.addWorkspace("ws-1");
      query.addLane("lane-1", "ws-1");
      query.addSession("session-1", "lane-1");
    });

    it("should validate a valid triple", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid workspace ID format", () => {
      const triple: BindingTriple = {
        workspaceId: "WS_INVALID", // uppercase and underscore
        laneId: "lane-1",
        sessionId: "session-1",
      };

      query.addWorkspace("WS_INVALID");
      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Invalid workspace ID format"))).toBe(true);
    });

    it("should reject invalid lane ID format", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane@invalid", // special character
        sessionId: "session-1",
      };

      query.addLane("lane@invalid", "ws-1");
      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Invalid lane ID format"))).toBe(true);
    });

    it("should reject invalid session ID format", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session!invalid", // special character
      };

      query.addSession("session!invalid", "lane-1");
      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Invalid session ID format"))).toBe(true);
    });

    it("should reject when workspace does not exist", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-nonexistent",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Workspace does not exist"))).toBe(true);
    });

    it("should reject when lane does not belong to workspace", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-1",
      };

      query.addLane("lane-2", "ws-other"); // different workspace
      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("does not belong to workspace"))).toBe(true);
    });

    it("should reject when session does not belong to lane", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-2",
      };

      query.addSession("session-2", "lane-other"); // different lane
      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("does not belong to lane"))).toBe(true);
    });

    it("should reject IDs that are too long", () => {
      const longId = "a".repeat(37); // > 36 chars
      const triple: BindingTriple = {
        workspaceId: longId,
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Invalid workspace ID format"))).toBe(true);
    });

    it("should reject empty IDs", () => {
      const triple: BindingTriple = {
        workspaceId: "",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Invalid workspace ID format"))).toBe(true);
    });

    it("should accumulate multiple errors", () => {
      const triple: BindingTriple = {
        workspaceId: "WS_INVALID",
        laneId: "lane-nonexistent",
        sessionId: "session-1",
      };

      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it("should allow hyphens and lowercase letters in IDs", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-prod-1",
        laneId: "lane-dev-2",
        sessionId: "session-test-3",
      };

      query.addWorkspace("ws-prod-1");
      query.addLane("lane-dev-2", "ws-prod-1");
      query.addSession("session-test-3", "lane-dev-2");

      const result = validateBindingTriple(triple, query);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
