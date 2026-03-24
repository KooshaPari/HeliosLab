import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveSessionSnapshot,
  loadSessionSnapshot,
  clearSessionSnapshot,
  type SessionSnapshot,
} from "./persistence";

// Create a mock collection that we can reuse
const createMockCollection = () => ({
  query: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  remove: vi.fn(),
});

let mockCollectionInstance: ReturnType<typeof createMockCollection>;

// Create a mock collection that we can reuse with remove method
const createMockCollectionWithRemove = () => ({
  query: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  remove: vi.fn(),
});

// Mock GoldfishDB module
vi.mock(import('../../main/goldfishdb/db'), () => {
  return {
    default: {
      collection: vi.fn(() => mockCollectionInstance),
    },
  };
});

describe("Session Snapshot Persistence", () => {
  beforeEach(() => {
    mockCollectionInstance = createMockCollectionWithRemove();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("saveSessionSnapshot()", () => {
    it("should insert new snapshot when none exists", () => {
      const workspaceId = "ws-test-001";
      const lanes: SessionSnapshot[] = [
        {
          laneId: "lane-1",
          lane: { state: "ready", transport: "cliproxy_harness" },
          session: { state: "attached", id: "sess-1" },
          terminal: { state: "active", id: "term-1" },
          createdAt: new Date().toISOString(),
        },
      ];

      mockCollectionInstance.query.mockReturnValue({ data: [] });
      mockCollectionInstance.insert.mockReturnValue({ id: "snap-1" });

      saveSessionSnapshot(workspaceId, lanes);

      expect(mockCollectionInstance.query).toHaveBeenCalled();
      expect(mockCollectionInstance.insert).toHaveBeenCalledWith({
        workspaceId,
        lanes: JSON.stringify(lanes),
        timestamp: expect.any(String),
      });
    });

    it("should update existing snapshot when one exists", () => {
      const workspaceId = "ws-test-002";
      const lanes: SessionSnapshot[] = [
        {
          laneId: "lane-1",
          lane: { state: "ready", transport: "cliproxy_harness" },
          session: { state: "attached", id: "sess-1" },
          terminal: { state: "active", id: "term-1" },
          createdAt: new Date().toISOString(),
        },
      ];

      mockCollectionInstance.query.mockReturnValue({
        data: [{ id: "existing-snap-1", workspaceId }],
      });

      saveSessionSnapshot(workspaceId, lanes);

      expect(mockCollectionInstance.update).toHaveBeenCalledWith("existing-snap-1", {
        workspaceId,
        lanes: JSON.stringify(lanes),
        timestamp: expect.any(String),
      });
    });

    it("should handle multiple lanes in snapshot", () => {
      const workspaceId = "ws-test-003";
      const lanes: SessionSnapshot[] = [
        {
          laneId: "lane-1",
          lane: { state: "ready", transport: "cliproxy_harness" },
          session: { state: "attached", id: "sess-1" },
          terminal: { state: "active", id: "term-1" },
          createdAt: new Date().toISOString(),
        },
        {
          laneId: "lane-2",
          lane: { state: "ready", transport: "native_openai" },
          session: { state: "detached" },
          terminal: { state: "idle" },
          createdAt: new Date().toISOString(),
        },
      ];

      mockCollectionInstance.query.mockReturnValue({ data: [] });
      mockCollectionInstance.insert.mockReturnValue({ id: "snap-2" });

      saveSessionSnapshot(workspaceId, lanes);

      const callArgs = mockCollectionInstance.insert.mock.calls[0][0];
      expect(JSON.parse(callArgs.lanes)).toHaveLength(2);
      expect(JSON.parse(callArgs.lanes)[0].laneId).toBe("lane-1");
      expect(JSON.parse(callArgs.lanes)[1].laneId).toBe("lane-2");
    });

    it("should silently fail on database error", () => {
      const workspaceId = "ws-test-004";
      const lanes: SessionSnapshot[] = [
        {
          laneId: "lane-1",
          lane: { state: "ready" },
          session: { state: "detached" },
          terminal: { state: "idle" },
          createdAt: new Date().toISOString(),
        },
      ];

      mockCollectionInstance.query.mockImplementation(() => {
        throw new Error("Database error");
      });

      expect(() => saveSessionSnapshot(workspaceId, lanes)).not.toThrow();
    });

    it("should save with timestamp when snapshot is created", () => {
      const workspaceId = "ws-test-005";
      const lanes: SessionSnapshot[] = [];

      mockCollectionInstance.query.mockReturnValue({ data: [] });
      mockCollectionInstance.insert.mockReturnValue({ id: "snap-5" });

      const beforeTime = new Date();
      saveSessionSnapshot(workspaceId, lanes);
      const afterTime = new Date();

      const callArgs = mockCollectionInstance.insert.mock.calls[0][0];
      const timestamp = new Date(callArgs.timestamp);

      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime() + 1000);
    });
  });

  describe("loadSessionSnapshot()", () => {
    it("should load existing snapshot", () => {
      const workspaceId = "ws-test-006";
      const lanes: SessionSnapshot[] = [
        {
          laneId: "lane-1",
          lane: { state: "ready", transport: "cliproxy_harness" },
          session: { state: "attached", id: "sess-1" },
          terminal: { state: "active", id: "term-1" },
          createdAt: new Date().toISOString(),
        },
      ];

      mockCollectionInstance.query.mockReturnValue({
        data: [
          {
            id: "snap-6",
            workspaceId,
            lanes: JSON.stringify(lanes),
          },
        ],
      });

      const result = loadSessionSnapshot(workspaceId);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result?.[0].laneId).toBe("lane-1");
      expect(result?.[0].lane.state).toBe("ready");
      expect(result?.[0].session.id).toBe("sess-1");
      expect(result?.[0].terminal.id).toBe("term-1");
    });

    it("should return null when no snapshot exists", () => {
      const workspaceId = "ws-test-007";

      mockCollectionInstance.query.mockReturnValue({ data: [] });

      const result = loadSessionSnapshot(workspaceId);

      expect(result).toBeNull();
    });

    it("should return null when snapshot has no lanes data", () => {
      const workspaceId = "ws-test-008";

      mockCollectionInstance.query.mockReturnValue({
        data: [{ id: "snap-8", workspaceId }],
      });

      const result = loadSessionSnapshot(workspaceId);

      expect(result).toBeNull();
    });

    it("should load multiple lanes from snapshot", () => {
      const workspaceId = "ws-test-009";
      const lanes: SessionSnapshot[] = [
        {
          laneId: "lane-1",
          lane: { state: "ready", transport: "cliproxy_harness" },
          session: { state: "attached", id: "sess-1" },
          terminal: { state: "active", id: "term-1" },
          createdAt: new Date().toISOString(),
        },
        {
          laneId: "lane-2",
          lane: { state: "ready", transport: "native_openai" },
          session: { state: "detached" },
          terminal: { state: "idle" },
          createdAt: new Date().toISOString(),
        },
      ];

      mockCollectionInstance.query.mockReturnValue({
        data: [
          {
            id: "snap-9",
            workspaceId,
            lanes: JSON.stringify(lanes),
          },
        ],
      });

      const result = loadSessionSnapshot(workspaceId);

      expect(result).toHaveLength(2);
      expect(result?.[0].laneId).toBe("lane-1");
      expect(result?.[1].laneId).toBe("lane-2");
    });

    it("should silently fail on invalid JSON", () => {
      const workspaceId = "ws-test-010";

      mockCollectionInstance.query.mockReturnValue({
        data: [
          {
            id: "snap-10",
            workspaceId,
            lanes: "invalid json {{{",
          },
        ],
      });

      const result = loadSessionSnapshot(workspaceId);

      expect(result).toBeNull();
    });

    it("should silently fail on database error", () => {
      const workspaceId = "ws-test-011";

      mockCollectionInstance.query.mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = loadSessionSnapshot(workspaceId);

      expect(result).toBeNull();
    });

    it("should find correct workspace snapshot among multiple", () => {
      const workspaceId1 = "ws-test-001";
      const workspaceId2 = "ws-test-002";

      const lanes1: SessionSnapshot[] = [
        {
          laneId: "lane-ws1",
          lane: { state: "ready" },
          session: { state: "detached" },
          terminal: { state: "idle" },
          createdAt: new Date().toISOString(),
        },
      ];

      const lanes2: SessionSnapshot[] = [
        {
          laneId: "lane-ws2",
          lane: { state: "ready" },
          session: { state: "detached" },
          terminal: { state: "idle" },
          createdAt: new Date().toISOString(),
        },
      ];

      mockCollectionInstance.query.mockReturnValue({
        data: [
          { id: "snap-1", workspaceId: workspaceId1, lanes: JSON.stringify(lanes1) },
          { id: "snap-2", workspaceId: workspaceId2, lanes: JSON.stringify(lanes2) },
        ],
      });

      const result = loadSessionSnapshot(workspaceId1);

      expect(result).not.toBeNull();
      expect(result?.[0].laneId).toBe("lane-ws1");
    });
  });

  describe("clearSessionSnapshot()", () => {
    it("should delete existing snapshot", () => {
      const workspaceId = "ws-test-012";

      mockCollectionInstance.query.mockReturnValue({
        data: [{ id: "snap-12", workspaceId }],
      });

      clearSessionSnapshot(workspaceId);

      expect(mockCollectionInstance.remove).toHaveBeenCalledWith("snap-12");
    });

    it("should do nothing when no snapshot exists", () => {
      const workspaceId = "ws-test-013";

      mockCollectionInstance.query.mockReturnValue({ data: [] });

      clearSessionSnapshot(workspaceId);

      expect(mockCollectionInstance.remove).not.toHaveBeenCalled();
    });

    it("should silently fail on database error", () => {
      const workspaceId = "ws-test-014";

      mockCollectionInstance.query.mockImplementation(() => {
        throw new Error("Database error");
      });

      expect(() => clearSessionSnapshot(workspaceId)).not.toThrow();
    });

    it("should delete correct snapshot among multiple", () => {
      const workspaceId1 = "ws-test-001";
      const workspaceId2 = "ws-test-002";

      mockCollectionInstance.query.mockReturnValue({
        data: [
          { id: "snap-1", workspaceId: workspaceId1 },
          { id: "snap-2", workspaceId: workspaceId2 },
        ],
      });

      clearSessionSnapshot(workspaceId1);

      expect(mockCollectionInstance.remove).toHaveBeenCalledWith("snap-1");
    });
  });

  describe("Round-trip: save then load", () => {
    it("should preserve lane data through save-load cycle", () => {
      const workspaceId = "ws-test-015";
      const originalLanes: SessionSnapshot[] = [
        {
          laneId: "lane-1",
          lane: { state: "ready", transport: "cliproxy_harness" },
          session: { state: "attached", id: "sess-1" },
          terminal: { state: "active", id: "term-1" },
          createdAt: "2025-02-28T10:00:00Z",
        },
      ];

      mockCollectionInstance.query.mockReturnValueOnce({ data: [] });
      mockCollectionInstance.insert.mockReturnValueOnce({ id: "snap-15" });

      saveSessionSnapshot(workspaceId, originalLanes);

      const insertCall = mockCollectionInstance.insert.mock.calls[0][0];

      mockCollectionInstance.query.mockReturnValueOnce({
        data: [
          {
            id: "snap-15",
            workspaceId,
            lanes: insertCall.lanes,
          },
        ],
      });

      const loadedLanes = loadSessionSnapshot(workspaceId);

      expect(loadedLanes).toEqual(originalLanes);
    });

    it("should preserve complex nested structures", () => {
      const workspaceId = "ws-test-016";
      const complexLanes: SessionSnapshot[] = [
        {
          laneId: "lane-1",
          lane: { state: "ready", transport: "cliproxy_harness" },
          session: { state: "attached", id: "sess-1" },
          terminal: { state: "active", id: "term-1" },
          createdAt: "2025-02-28T10:00:00Z",
        },
        {
          laneId: "lane-2",
          lane: { state: "ready", transport: "native_openai" },
          session: { state: "detached" },
          terminal: { state: "idle" },
          createdAt: "2025-02-28T11:00:00Z",
        },
      ];

      mockCollectionInstance.query.mockReturnValueOnce({ data: [] });
      mockCollectionInstance.insert.mockReturnValueOnce({ id: "snap-16" });

      saveSessionSnapshot(workspaceId, complexLanes);

      const insertCall = mockCollectionInstance.insert.mock.calls[0][0];
      mockCollectionInstance.query.mockReturnValueOnce({
        data: [
          {
            id: "snap-16",
            workspaceId,
            lanes: insertCall.lanes,
          },
        ],
      });

      const loadedLanes = loadSessionSnapshot(workspaceId);

      expect(loadedLanes).toEqual(complexLanes);
      expect(loadedLanes).toHaveLength(2);
      expect(loadedLanes?.[0].laneId).toBe("lane-1");
      expect(loadedLanes?.[1].laneId).toBe("lane-2");
    });

    it("should preserve empty snapshot", () => {
      const workspaceId = "ws-test-017";
      const emptyLanes: SessionSnapshot[] = [];

      mockCollectionInstance.query.mockReturnValueOnce({ data: [] });
      mockCollectionInstance.insert.mockReturnValueOnce({ id: "snap-17" });

      saveSessionSnapshot(workspaceId, emptyLanes);

      const insertCall = mockCollectionInstance.insert.mock.calls[0][0];
      mockCollectionInstance.query.mockReturnValueOnce({
        data: [
          {
            id: "snap-17",
            workspaceId,
            lanes: insertCall.lanes,
          },
        ],
      });

      const loadedLanes = loadSessionSnapshot(workspaceId);

      expect(loadedLanes).toEqual([]);
    });
  });

  describe("Workspace isolation", () => {
    it("should not mix data between workspaces", () => {
      const ws1 = "ws-001";
      const ws2 = "ws-002";

      const lanes1: SessionSnapshot[] = [
        {
          laneId: "lane-ws1",
          lane: { state: "ready" },
          session: { state: "detached" },
          terminal: { state: "idle" },
          createdAt: new Date().toISOString(),
        },
      ];

      const lanes2: SessionSnapshot[] = [
        {
          laneId: "lane-ws2",
          lane: { state: "closed" },
          session: { state: "attached", id: "sess-2" },
          terminal: { state: "active", id: "term-2" },
          createdAt: new Date().toISOString(),
        },
      ];

      mockCollectionInstance.query.mockReturnValueOnce({ data: [] });
      mockCollectionInstance.insert.mockReturnValueOnce({ id: "snap-1" });
      saveSessionSnapshot(ws1, lanes1);

      mockCollectionInstance.query.mockReturnValueOnce({ data: [] });
      mockCollectionInstance.insert.mockReturnValueOnce({ id: "snap-2" });
      saveSessionSnapshot(ws2, lanes2);

      mockCollectionInstance.query.mockReturnValueOnce({
        data: [
          { id: "snap-1", workspaceId: ws1, lanes: JSON.stringify(lanes1) },
          { id: "snap-2", workspaceId: ws2, lanes: JSON.stringify(lanes2) },
        ],
      });

      const result = loadSessionSnapshot(ws1);

      expect(result).toHaveLength(1);
      expect(result?.[0].laneId).toBe("lane-ws1");
    });
  });
});
