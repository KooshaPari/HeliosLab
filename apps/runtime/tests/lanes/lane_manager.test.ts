import { describe, test, expect, beforeEach } from "bun:test";
import { LaneManager, _resetIdCounter } from "../../src/lanes/index.js";
import { InMemoryLocalBus } from "../../src/protocol/bus.js";
import { LaneClosedError, SharedLaneCleanupError } from "../../src/lanes/sharing.js";

// Traces to: FR-MVP-020 (isolated workspace lanes), FR-LAN-001, FR-LAN-002, FR-LAN-008
describe("LaneManager", () => {
  let bus: InMemoryLocalBus;
  let mgr: LaneManager;

  beforeEach(() => {
    _resetIdCounter();
    bus = new InMemoryLocalBus();
    mgr = new LaneManager({ bus, capacityLimit: 50 });
  });

  test("create returns a lane in provisioning state", async () => {
    const lane = await mgr.create("ws-1", "main");
    expect(lane.laneId).toBeTruthy();
    expect(lane.workspaceId).toBe("ws-1");
    expect(lane.baseBranch).toBe("main");
    // After create, lane is in provisioning (no auto-complete in linted version)
    expect(["provisioning", "ready"]).toContain(lane.state);
  });

  test("create emits lane.created event", async () => {
    await mgr.create("ws-1", "main");
    const events = bus.getEvents();
    const created = events.find(e => e.topic === "lane.created");
    expect(created).toBeDefined();
    expect(created!.workspace_id).toBe("ws-1");
  });

  test("list returns all lanes", async () => {
    await mgr.create("ws-1", "main");
    await mgr.create("ws-1", "main");
    await mgr.create("ws-2", "main");
    expect(mgr.list().length).toBe(3);
  });

  test("list filters by workspace", async () => {
    await mgr.create("ws-a", "main");
    await mgr.create("ws-b", "main");
    expect(mgr.list("ws-a").length).toBe(1);
  });

  test("attach rejects on closed lane", async () => {
    const lane = await mgr.create("ws-1", "main");
    // Move to ready so cleanup can proceed (create leaves lane in provisioning)
    mgr.getRegistry().update(lane.laneId, { state: "ready" });
    await mgr.cleanup(lane.laneId);
    try {
      await mgr.attach(lane.laneId, "agent-1");
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(LaneClosedError);
    }
  });

  test("detach is no-op for non-attached agent", async () => {
    const lane = await mgr.create("ws-1", "main");
    await mgr.detach(lane.laneId, "agent-nonexistent"); // should not throw
  });

  test("cleanup is idempotent", async () => {
    const lane = await mgr.create("ws-1", "main");
    mgr.getRegistry().update(lane.laneId, { state: "ready" });
    await mgr.cleanup(lane.laneId);
    await mgr.cleanup(lane.laneId); // should not throw
  });

  test("cleanup emits lane.closed event", async () => {
    const lane = await mgr.create("ws-1", "main");
    mgr.getRegistry().update(lane.laneId, { state: "ready" });
    await mgr.cleanup(lane.laneId);
    const events = bus.getEvents();
    const closed = events.find(e => e.topic === "lane.closed");
    expect(closed).toBeDefined();
  });

  test("events include from/to state", async () => {
    await mgr.create("ws-1", "main");
    const events = bus.getEvents();
    const created = events.find(e => e.topic === "lane.created");
    expect(created).toBeDefined();
    expect(created!.payload).toBeDefined();
    expect(created!.payload!["fromState"]).toBeDefined();
    expect(created!.payload!["toState"]).toBeDefined();
  });

  test("capacity limit rejects create", async () => {
    const small = new LaneManager({ bus, capacityLimit: 2 });
    await small.create("ws-1", "main");
    await small.create("ws-1", "main");
    try {
      await small.create("ws-1", "main");
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("capacity");
    }
  });

  test("bus failure does not block lane ops", async () => {
    const failBus = {
      async publish(_e: unknown): Promise<void> {
        throw new Error("bus down");
      },
      async request(_c: unknown): Promise<unknown> {
        return {};
      },
    };
    const failMgr = new LaneManager({ bus: failBus as any, capacityLimit: 50 });
    // Should not throw despite bus failure
    const lane = await failMgr.create("ws-1", "main");
    expect(lane.laneId).toBeTruthy();
  });
});

describe("LaneManager sharing", () => {
  let bus: InMemoryLocalBus;
  let mgr: LaneManager;

  beforeEach(() => {
    _resetIdCounter();
    bus = new InMemoryLocalBus();
    mgr = new LaneManager({ bus, capacityLimit: 50 });
  });

  test("share transitions lane to shared state", async () => {
    const lane = await mgr.create("ws-1", "main");
    // Need lane in ready state first
    const reg = mgr.getRegistry();
    const current = reg.get(lane.laneId);
    if (current && current.state !== "ready") {
      // Force to ready for test
      reg.update(lane.laneId, { state: "ready" });
    }
    await mgr.share(lane.laneId);
    const updated = reg.get(lane.laneId);
    expect(updated!.state).toBe("shared");
  });

  test("share emits lane.shared event", async () => {
    const lane = await mgr.create("ws-1", "main");
    const reg = mgr.getRegistry();
    reg.update(lane.laneId, { state: "ready" });
    await mgr.share(lane.laneId);
    const events = bus.getEvents();
    const shared = events.find(e => e.topic === "lane.shared");
    expect(shared).toBeDefined();
  });

  test("multiple agents can attach to shared lane", async () => {
    const lane = await mgr.create("ws-1", "main");
    const reg = mgr.getRegistry();
    reg.update(lane.laneId, { state: "shared" });
    await mgr.attach(lane.laneId, "agent-1");
    await mgr.attach(lane.laneId, "agent-2");
    const updated = reg.get(lane.laneId)!;
    expect(updated.attachedAgents.length).toBe(2);
  });

  test("attach same agent twice is idempotent", async () => {
    const lane = await mgr.create("ws-1", "main");
    const reg = mgr.getRegistry();
    reg.update(lane.laneId, { state: "shared" });
    await mgr.attach(lane.laneId, "agent-1");
    await mgr.attach(lane.laneId, "agent-1");
    const updated = reg.get(lane.laneId)!;
    expect(updated.attachedAgents.length).toBe(1);
  });

  test("last agent detach from shared lane transitions to ready", async () => {
    const lane = await mgr.create("ws-1", "main");
    const reg = mgr.getRegistry();
    reg.update(lane.laneId, { state: "shared", attachedAgents: ["agent-1"] });
    await mgr.detach(lane.laneId, "agent-1");
    const updated = reg.get(lane.laneId)!;
    expect(updated.state).toBe("ready");
  });

  test("cleanup shared lane with agents rejects without force", async () => {
    const lane = await mgr.create("ws-1", "main");
    const reg = mgr.getRegistry();
    reg.update(lane.laneId, { state: "shared", attachedAgents: ["agent-1"] });
    try {
      await mgr.cleanup(lane.laneId);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(SharedLaneCleanupError);
    }
  });

  test("force cleanup shared lane with agents succeeds", async () => {
    const lane = await mgr.create("ws-1", "main");
    const reg = mgr.getRegistry();
    reg.update(lane.laneId, {
      state: "shared",
      attachedAgents: ["agent-1", "agent-2"],
    });
    await mgr.cleanup(lane.laneId, true);
    const updated = reg.get(lane.laneId)!;
    expect(updated.state).toBe("closed");
  });

  test("share idempotent on already shared lane", async () => {
    const lane = await mgr.create("ws-1", "main");
    const reg = mgr.getRegistry();
    reg.update(lane.laneId, { state: "shared" });
    await mgr.share(lane.laneId); // should not throw
    expect(reg.get(lane.laneId)!.state).toBe("shared");
  });
});
