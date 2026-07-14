/**
 * FR-HELIOS-073: Lane Sharing Tests
 * Verifies: FR-LAN-007 (Mark lanes as shared for multi-agent concurrent access)
 * Traces to: FR-MVP-021 (terminal sharing)
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { LaneRegistry } from "../../../src/lanes/registry.js";
import type { LaneRecord } from "../../../src/lanes/registry.js";
import {
  shareLane,
  attachAgent,
  detachAgent,
  forceDetachAll,
  LaneClosedError,
} from "../../../src/lanes/sharing.js";

function makeRecord(overrides: Partial<LaneRecord> = {}): LaneRecord {
  const now = new Date().toISOString();
  return {
    laneId: `lane-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: "ws-1",
    state: "ready",
    worktreePath: null,
    parTaskPid: null,
    attachedAgents: [],
    baseBranch: "main",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Lane Sharing (FR-008-007)", () => {
  let registry: LaneRegistry;

  beforeEach(() => {
    registry = new LaneRegistry();
  });

  test("shareLane transitions ready -> shared", async () => {
    registry.register(makeRecord({ laneId: "sh1", state: "ready" }));
    const result = await shareLane(registry, "sh1");
    expect(result.fromState).toBe("ready");
    expect(result.toState).toBe("shared");
    expect(registry.get("sh1")!.state).toBe("shared");
  });

  test("shareLane is idempotent on shared lane", async () => {
    registry.register(makeRecord({ laneId: "sh2", state: "shared" }));
    const result = await shareLane(registry, "sh2");
    expect(result.fromState).toBe("shared");
    expect(result.toState).toBe("shared");
  });

  test("shareLane rejects closed lane", async () => {
    registry.register(makeRecord({ laneId: "sh3", state: "closed" }));
    try {
      await shareLane(registry, "sh3");
      expect(true).toBe(false);
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      expect(e).toBeInstanceOf(LaneClosedError);
    }
  });

  test("attachAgent adds agent to list", async () => {
    registry.register(makeRecord({ laneId: "at1", state: "shared" }));
    await attachAgent(registry, "at1", "agent-a");
    expect(registry.get("at1")!.attachedAgents).toEqual(["agent-a"]);
  });

  test("attachAgent is idempotent", async () => {
    registry.register(makeRecord({ laneId: "at2", state: "shared" }));
    await attachAgent(registry, "at2", "agent-a");
    await attachAgent(registry, "at2", "agent-a");
    expect(registry.get("at2")!.attachedAgents.length).toBe(1);
  });

  test("attachAgent allows multiple agents", async () => {
    registry.register(makeRecord({ laneId: "at3", state: "shared" }));
    await attachAgent(registry, "at3", "agent-a");
    await attachAgent(registry, "at3", "agent-b");
    expect(registry.get("at3")!.attachedAgents.length).toBe(2);
  });

  test("attachAgent rejects closed lane", async () => {
    registry.register(makeRecord({ laneId: "at4", state: "closed" }));
    try {
      await attachAgent(registry, "at4", "agent-a");
      expect(true).toBe(false);
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      expect(e).toBeInstanceOf(LaneClosedError);
    }
  });

  test("detachAgent removes agent", async () => {
    registry.register(
      makeRecord({
        laneId: "dt1",
        state: "shared",
        attachedAgents: ["agent-a", "agent-b"],
      })
    );
    await detachAgent(registry, "dt1", "agent-a");
    expect(registry.get("dt1")!.attachedAgents).toEqual(["agent-b"]);
  });

  test("detachAgent is no-op for non-attached agent", async () => {
    registry.register(
      makeRecord({
        laneId: "dt2",
        state: "shared",
        attachedAgents: ["agent-a"],
      })
    );
    const result = await detachAgent(registry, "dt2", "agent-z");
    expect(result.transitioned).toBe(false);
  });

  test("last agent detach from shared transitions to ready", async () => {
    registry.register(
      makeRecord({
        laneId: "dt3",
        state: "shared",
        attachedAgents: ["agent-a"],
      })
    );
    const result = await detachAgent(registry, "dt3", "agent-a");
    expect(result.transitioned).toBe(true);
    expect(result.fromState).toBe("shared");
    expect(result.toState).toBe("ready");
    expect(registry.get("dt3")!.state).toBe("ready");
  });

  test("forceDetachAll removes all agents and transitions", async () => {
    registry.register(
      makeRecord({
        laneId: "fd1",
        state: "shared",
        attachedAgents: ["agent-a", "agent-b", "agent-c"],
      })
    );
    const result = await forceDetachAll(registry, "fd1");
    expect(result.detachedAgents).toEqual(["agent-a", "agent-b", "agent-c"]);
    expect(result.transitioned).toBe(true);
    expect(registry.get("fd1")!.state).toBe("ready");
    expect(registry.get("fd1")!.attachedAgents.length).toBe(0);
  });

  test("forceDetachAll on non-shared lane does not transition", async () => {
    registry.register(
      makeRecord({
        laneId: "fd2",
        state: "ready",
        attachedAgents: ["agent-a"],
      })
    );
    const result = await forceDetachAll(registry, "fd2");
    expect(result.transitioned).toBe(false);
    expect(result.detachedAgents).toEqual(["agent-a"]);
  });
});
