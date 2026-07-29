import { describe, test, expect } from "bun:test";
import {
  LaneRegistry,
  DuplicateLaneError,
  LaneNotFoundError,
  LaneCapacityExceededError,
} from "../../src/lanes/registry.js";
import type { LaneRecord } from "../../src/lanes/registry.js";

// Traces to: FR-MVP-013 (persist lane/session), FR-MVP-020 (isolated workspace lanes)

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

describe("LaneRegistry", () => {
  test("register and get", () => {
    const reg = new LaneRegistry();
    const rec = makeRecord({ laneId: "lane-1" });
    reg.register(rec);
    const got = reg.get("lane-1");
    expect(got).toBeDefined();
    expect(got!.laneId).toBe("lane-1");
  });

  test("duplicate lane throws", () => {
    const reg = new LaneRegistry();
    const rec = makeRecord({ laneId: "lane-dup" });
    reg.register(rec);
    expect(() => reg.register(rec)).toThrow(DuplicateLaneError);
  });

  test("get non-existent returns undefined", () => {
    const reg = new LaneRegistry();
    expect(reg.get("nonexistent")).toBeUndefined();
  });

  test("getByWorkspace", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "l1", workspaceId: "ws-a" }));
    reg.register(makeRecord({ laneId: "l2", workspaceId: "ws-a" }));
    reg.register(makeRecord({ laneId: "l3", workspaceId: "ws-b" }));
    expect(reg.getByWorkspace("ws-a").length).toBe(2);
    expect(reg.getByWorkspace("ws-b").length).toBe(1);
    expect(reg.getByWorkspace("ws-c").length).toBe(0);
  });

  test("update modifies record", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "l-upd", state: "new" }));
    reg.update("l-upd", { state: "provisioning" });
    expect(reg.get("l-upd")!.state).toBe("provisioning");
  });

  test("update non-existent throws", () => {
    const reg = new LaneRegistry();
    expect(() => reg.update("nope", { state: "ready" })).toThrow(LaneNotFoundError);
  });

  test("remove cleans up indexes", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "l-rm", workspaceId: "ws-rm" }));
    expect(reg.getByWorkspace("ws-rm").length).toBe(1);
    reg.remove("l-rm");
    expect(reg.get("l-rm")).toBeUndefined();
    expect(reg.getByWorkspace("ws-rm").length).toBe(0);
  });

  test("remove non-existent is no-op", () => {
    const reg = new LaneRegistry();
    reg.remove("nonexistent"); // should not throw
  });

  test("list returns all", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "a" }));
    reg.register(makeRecord({ laneId: "b" }));
    expect(reg.list().length).toBe(2);
  });

  test("count", () => {
    const reg = new LaneRegistry();
    expect(reg.count()).toBe(0);
    reg.register(makeRecord({ laneId: "c" }));
    expect(reg.count()).toBe(1);
  });

  test("getActive excludes closed lanes", () => {
    const reg = new LaneRegistry();
    reg.register(makeRecord({ laneId: "active-1", state: "ready" }));
    reg.register(makeRecord({ laneId: "closed-1", state: "closed" }));
    const active = reg.getActive();
    expect(active.length).toBe(1);
    expect(active[0]!.laneId).toBe("active-1");
  });

  test("capacity limit enforced", () => {
    const reg = new LaneRegistry(3);
    reg.register(makeRecord({ laneId: "c1" }));
    reg.register(makeRecord({ laneId: "c2" }));
    reg.register(makeRecord({ laneId: "c3" }));
    expect(() => reg.register(makeRecord({ laneId: "c4" }))).toThrow(LaneCapacityExceededError);
  });

  test("closed lanes do not count toward capacity", () => {
    const reg = new LaneRegistry(2);
    reg.register(makeRecord({ laneId: "cap1", state: "ready" }));
    reg.register(makeRecord({ laneId: "cap2", state: "closed" }));
    // Only 1 active lane, so we should be able to add another
    reg.register(makeRecord({ laneId: "cap3", state: "ready" }));
    expect(reg.count()).toBe(3);
  });

  test("returns copies, not references", () => {
    const reg = new LaneRegistry();
    const rec = makeRecord({ laneId: "ref-test" });
    reg.register(rec);
    const got = reg.get("ref-test")!;
    got.state = "closed";
    expect(reg.get("ref-test")!.state).toBe("new"); // original unchanged
  });
});
