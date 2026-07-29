/**
 * FR-HELIOS-043: Lane Registry Tests
 * Verifies: FR-LAN-001 (Lane state machine), FR-LAN-007 (Concurrent access marking)
 */
import { describe, test, expect } from "bun:test";
import {
  LaneRegistry,
  DuplicateLaneError,
  LaneNotFoundError,
  LaneCapacityExceededError,
} from "../../../src/lanes/registry.js";
import type { LaneRecord } from "../../../src/lanes/registry.js";

function makeRecord(overrides: Partial<LaneRecord> = {}): LaneRecord {
  const now = new Date().toISOString();
  return {
    laneId: `lane-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: "ws-1",
    state: "new",
    worktreePath: null,
    parTaskPid: null,
    attachedAgents: [],
    baseBranch: "main",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("LaneRegistry (FR-008-001)", () => {
  test("register and get returns copy", () => {
    const reg = new LaneRegistry();
    const rec = makeRecord({ laneId: "r1" });
    reg.register(rec);
    const got = reg.get("r1");
    expect(got).toBeDefined();
    expect(got!.laneId).toBe("r1");
    // Mutation of returned copy does not affect internal state
    got!.state = "closed";
    expect(reg.get("r1")!.state).toBe("new");
  });

  test("duplicate registration throws DuplicateLaneError", () => {
    const reg = new LaneRegistry();
    const rec = makeRecord({ laneId: "dup" });
    reg.register(rec);
    expect(() => reg.register(rec)).toThrow(DuplicateLaneError);
  });

  test("get non-existent returns undefined", () => {
    const reg = new LaneRegistry();
    expect(reg.get("nonexistent")).toBeUndefined();
  });

  test("getByWorkspace returns correct subset", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "wa1", workspaceId: "ws-a" }));
    reg.register(makeRecord({ laneId: "wa2", workspaceId: "ws-a" }));
    reg.register(makeRecord({ laneId: "wb1", workspaceId: "ws-b" }));
    expect(reg.getByWorkspace("ws-a").length).toBe(2);
    expect(reg.getByWorkspace("ws-b").length).toBe(1);
    expect(reg.getByWorkspace("ws-c").length).toBe(0);
  });

  test("update modifies record and sets updatedAt", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "upd1", state: "new" }));
    const _before = reg.get("upd1")!.updatedAt;
    // Small delay to get different timestamp
    reg.update("upd1", { state: "provisioning" });
    const after = reg.get("upd1")!;
    expect(after.state).toBe("provisioning");
    expect(after.updatedAt).toBeTruthy();
  });

  test("update non-existent throws LaneNotFoundError", () => {
    const reg = new LaneRegistry();
    expect(() => reg.update("nope", { state: "ready" })).toThrow(LaneNotFoundError);
  });

  test("update workspace re-indexes", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "idx1", workspaceId: "ws-old" }));
    reg.update("idx1", { workspaceId: "ws-new" });
    expect(reg.getByWorkspace("ws-old").length).toBe(0);
    expect(reg.getByWorkspace("ws-new").length).toBe(1);
  });

  test("remove cleans up indexes", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "rm1", workspaceId: "ws-rm" }));
    reg.remove("rm1");
    expect(reg.get("rm1")).toBeUndefined();
    expect(reg.getByWorkspace("ws-rm").length).toBe(0);
  });

  test("remove non-existent is no-op", () => {
    const reg = new LaneRegistry();
    reg.remove("nonexistent"); // should not throw
  });

  test("list returns all records", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "l1" }));
    reg.register(makeRecord({ laneId: "l2" }));
    expect(reg.list().length).toBe(2);
  });

  test("count tracks size", () => {
    const reg = new LaneRegistry();
    expect(reg.count()).toBe(0);
    reg.register(makeRecord({ laneId: "c1" }));
    expect(reg.count()).toBe(1);
    reg.register(makeRecord({ laneId: "c2" }));
    expect(reg.count()).toBe(2);
  });

  test("getActive excludes closed lanes", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "act1", state: "ready" }));
    reg.register(makeRecord({ laneId: "act2", state: "closed" }));
    reg.register(makeRecord({ laneId: "act3", state: "running" }));
    const active = reg.getActive();
    expect(active.length).toBe(2);
    expect(active.map(l => l.laneId).sort()).toEqual(["act1", "act3"]);
  });

  test("capacity limit enforced on active lanes (NFR-008-003)", () => {
    const reg = new LaneRegistry(3);
    reg.register(makeRecord({ laneId: "cap1", state: "ready" }));
    reg.register(makeRecord({ laneId: "cap2", state: "running" }));
    reg.register(makeRecord({ laneId: "cap3", state: "provisioning" }));
    expect(() => reg.register(makeRecord({ laneId: "cap4" }))).toThrow(LaneCapacityExceededError);
  });

  test("closed lanes do not count toward capacity", () => {
    const reg = new LaneRegistry(2);
    reg.register(makeRecord({ laneId: "cc1", state: "ready" }));
    reg.register(makeRecord({ laneId: "cc2", state: "closed" }));
    // Only 1 active, so can add another
    reg.register(makeRecord({ laneId: "cc3", state: "ready" }));
    expect(reg.count()).toBe(3);
    expect(reg.getActive().length).toBe(2);
  });
});
