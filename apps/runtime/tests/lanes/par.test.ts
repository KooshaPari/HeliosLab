import {
  ParManager,
  _resetParIdCounter,
  ParSpawnError,
  ParNotFoundError,
  LaneNotReadyError,
} from "../../src/lanes/par.js";
import type { SpawnFn, SpawnResult } from "../../src/lanes/par.js";
import { LaneRegistry } from "../../src/lanes/registry.js";
import { InMemoryLocalBus } from "../../src/protocol/bus.js";

// Traces to: FR-MVP-005 (interrupt/cancel), FR-MVP-009 (execute in terminal), FR-MVP-022 (muxer dispatch)

// ── Mock spawn factory ──────────────────────────────────────────────────────

function createMockSpawn(opts?: {
  pid?: number;
  exitCode?: number;
  exitDelay?: number;
  stdout?: string;
  stderr?: string;
  shouldThrow?: boolean;
}): { spawnFn: SpawnFn; kills: number[]; spawned: string[][] } {
  const kills: number[] = [];
  const spawned: string[][] = [];
  const pid = opts?.pid ?? 12345;
  const exitCode = opts?.exitCode ?? 0;
  const exitDelay = opts?.exitDelay ?? 0;
  const stdoutText = opts?.stdout ?? "";
  const stderrText = opts?.stderr ?? "";

  const spawnFn: SpawnFn = (cmd, _spawnOpts) => {
    if (opts?.shouldThrow) {
      throw new Error("spawn failed: binary not found");
    }
    spawned.push(cmd);

    let resolveExit: (code: number) => void;
    const exitedPromise = new Promise<number>(resolve => {
      resolveExit = resolve;
    });

    if (exitDelay > 0) {
      setTimeout(() => resolveExit(exitCode), exitDelay);
    } else {
      // Resolve on next tick to allow monitoring to be set up
      queueMicrotask(() => resolveExit(exitCode));
    }

    const result: SpawnResult = {
      pid,
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stdoutText));
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stderrText));
          controller.close();
        },
      }),
      exited: exitedPromise,
      kill(signal?: number) {
        kills.push(signal ?? 15);
        // Resolve exit on kill
        resolveExit(exitCode);
      },
    };

    return result;
  };

  return { spawnFn, kills, spawned };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function createLaneInRegistry(
  registry: LaneRegistry,
  overrides?: Partial<{
    laneId: string;
    state: string;
    workspaceId: string;
    worktreePath: string;
  }>
) {
  const laneId = overrides?.laneId ?? "test-lane-1";
  const _record = {
    laneId,
    workspaceId: overrides?.workspaceId ?? "ws-1",
    state: (overrides?.state ?? "ready") as any,
    worktreePath: overrides?.worktreePath ?? "/tmp/worktree",
    parTaskPid: null,
    attachedAgents: [],
    baseBranch: "main",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  registry.register(_record);
  return _record;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ParManager - T011: Par task binding", () => {
  let registry: LaneRegistry;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    _resetParIdCounter();
    registry = new LaneRegistry();
    bus = new InMemoryLocalBus();
  });

  test("bindParTask creates binding with correct fields", async () => {
    createLaneInRegistry(registry);
    const { spawnFn } = createMockSpawn({ pid: 42, exitDelay: 60000 });
    const mgr = new ParManager({ registry, bus, spawnFn });

    const _binding = await mgr.bindParTask("test-lane-1", "/tmp/worktree");

    expect(binding.laneId).toBe("test-lane-1");
    expect(binding.pid).toBe(42);
    expect(binding.worktreePath).toBe("/tmp/worktree");
    expect(binding.status).toBe("active");
    expect(binding.parTaskId).toBeTruthy();
  });

  test("bindParTask updates lane record with PID", async () => {
    createLaneInRegistry(registry);
    const { spawnFn } = createMockSpawn({ pid: 42, exitDelay: 60000 });
    const mgr = new ParManager({ registry, bus, spawnFn });

    await mgr.bindParTask("test-lane-1", "/tmp/worktree");

    const lane = registry.get("test-lane-1");
    expect(lane!.parTaskPid).toBe(42);
  });

  test("bindParTask emits lane.par_task.bound event", async () => {
    createLaneInRegistry(registry);
    const { spawnFn } = createMockSpawn({ pid: 42 });
    const mgr = new ParManager({ registry, bus, spawnFn });

    await mgr.bindParTask("test-lane-1", "/tmp/worktree");

    const events = bus.getEvents();
    const bound = events.find(e => e.topic === "lane.par_task.bound");
    expect(bound).toBeDefined();
    expect(bound!.payload!["pid"]).toBe(42);
  });

  test("bindParTask spawns par with correct cwd", async () => {
    createLaneInRegistry(registry);
    const { spawnFn, spawned } = createMockSpawn({ pid: 42 });
    const mgr = new ParManager({ registry, bus, spawnFn });

    await mgr.bindParTask("test-lane-1", "/my/worktree");

    expect(spawned.length).toBe(1);
    expect(spawned[0]).toEqual(["par", "task", "create", "--cwd", "/my/worktree"]);
  });

  test("bindParTask throws ParSpawnError when spawn fails", async () => {
    createLaneInRegistry(registry);
    const { spawnFn } = createMockSpawn({ shouldThrow: true });
    const mgr = new ParManager({ registry, bus, spawnFn });

    try {
      await mgr.bindParTask("test-lane-1", "/tmp/worktree");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ParSpawnError);
    }
  });

  test("bindParTask throws when lane not found", async () => {
    const { spawnFn } = createMockSpawn();
    const mgr = new ParManager({ registry, bus, spawnFn });

    try {
      await mgr.bindParTask("nonexistent", "/tmp/worktree");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ParSpawnError);
    }
  });
});

describe("ParManager - T012: Par task termination", () => {
  let registry: LaneRegistry;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    _resetParIdCounter();
    registry = new LaneRegistry();
    bus = new InMemoryLocalBus();
  });

  test("terminateParTask sends SIGTERM and cleans up", async () => {
    createLaneInRegistry(registry);
    const { spawnFn, kills } = createMockSpawn({ pid: 42, exitDelay: 5 });
    const mgr = new ParManager({
      registry,
      bus,
      spawnFn,
      forceKillTimeoutMs: 500,
    });

    await mgr.bindParTask("test-lane-1", "/tmp/worktree");
    await mgr.terminateParTask("test-lane-1");

    expect(kills).toContain(15); // SIGTERM
    expect(mgr.getBinding("test-lane-1")).toBeUndefined();
    expect(registry.get("test-lane-1")!.parTaskPid).toBeNull();
  });

  test("terminateParTask emits lane.par_task.terminated event", async () => {
    createLaneInRegistry(registry);
    const { spawnFn } = createMockSpawn({ pid: 42, exitDelay: 5 });
    const mgr = new ParManager({
      registry,
      bus,
      spawnFn,
      forceKillTimeoutMs: 500,
    });

    await mgr.bindParTask("test-lane-1", "/tmp/worktree");
    bus.getEvents(); // clear
    await mgr.terminateParTask("test-lane-1");

    const events = bus.getEvents();
    const terminated = events.find(e => e.topic === "lane.par_task.terminated");
    expect(terminated).toBeDefined();
  });

  test("terminateParTask is idempotent on already-terminated binding", async () => {
    createLaneInRegistry(registry);
    const { spawnFn } = createMockSpawn({ pid: 42, exitDelay: 5 });
    const mgr = new ParManager({
      registry,
      bus,
      spawnFn,
      forceKillTimeoutMs: 500,
    });

    await mgr.bindParTask("test-lane-1", "/tmp/worktree");
    await mgr.terminateParTask("test-lane-1");
    await mgr.terminateParTask("test-lane-1"); // should not throw
  });

  test("terminateParTask is no-op when no binding exists", async () => {
    const { spawnFn } = createMockSpawn();
    const mgr = new ParManager({ registry, bus, spawnFn });

    // Should not throw
    await mgr.terminateParTask("nonexistent-lane");
  });
});

describe("ParManager - T013: Command execution", () => {
  let registry: LaneRegistry;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    _resetParIdCounter();
    registry = new LaneRegistry();
    bus = new InMemoryLocalBus();
  });

  test("executeInLane runs command and returns result", async () => {
    createLaneInRegistry(registry, { state: "ready" });
    // First spawn for bindParTask (long-lived), second for executeInLane
    let callCount = 0;
    const spawnFn: SpawnFn = (cmd, opts) => {
      callCount++;
      if (callCount === 1) {
        // bind spawn - long lived
        return createMockSpawn({ pid: 42, exitDelay: 60000 }).spawnFn(cmd, opts);
      }
      // exec spawn
      return createMockSpawn({
        pid: 43,
        stdout: "hello world",
        exitCode: 0,
      }).spawnFn(cmd, opts);
    };

    const mgr = new ParManager({ registry, bus, spawnFn });
    await mgr.bindParTask("test-lane-1", "/tmp/worktree");

    // Force lane back to ready (bind monitoring may have changed it)
    registry.update("test-lane-1", { state: "ready" });

    const result = await mgr.executeInLane("test-lane-1", ["echo", "hello"]);

    expect(result.stdout).toBe("hello world");
    expect(result.exitCode).toBe(0);
    expect(result.duration).toBeGreaterThan(0);
  });

  test("executeInLane transitions lane to running then back to ready", async () => {
    createLaneInRegistry(registry, { state: "ready" });
    let callCount = 0;
    const spawnFn: SpawnFn = (cmd, opts) => {
      callCount++;
      if (callCount === 1) {
        return createMockSpawn({ pid: 42, exitDelay: 60000 }).spawnFn(cmd, opts);
      }
      return createMockSpawn({ pid: 43, exitCode: 0 }).spawnFn(cmd, opts);
    };

    const mgr = new ParManager({ registry, bus, spawnFn });
    await mgr.bindParTask("test-lane-1", "/tmp/worktree");
    registry.update("test-lane-1", { state: "ready" });

    await mgr.executeInLane("test-lane-1", ["ls"]);

    const lane = registry.get("test-lane-1");
    expect(lane!.state).toBe("ready");
  });

  test("executeInLane emits command.started and command.completed events", async () => {
    createLaneInRegistry(registry, { state: "ready" });
    let callCount = 0;
    const spawnFn: SpawnFn = (cmd, opts) => {
      callCount++;
      if (callCount === 1) {
        return createMockSpawn({ pid: 42, exitDelay: 60000 }).spawnFn(cmd, opts);
      }
      return createMockSpawn({ pid: 43 }).spawnFn(cmd, opts);
    };

    const mgr = new ParManager({ registry, bus, spawnFn });
    await mgr.bindParTask("test-lane-1", "/tmp/worktree");
    registry.update("test-lane-1", { state: "ready" });

    await mgr.executeInLane("test-lane-1", ["ls"]);

    const events = bus.getEvents();
    expect(events.some(e => e.topic === "lane.command.started")).toBe(true);
    expect(events.some(e => e.topic === "lane.command.completed")).toBe(true);
  });

  test("executeInLane rejects on closed lane", async () => {
    createLaneInRegistry(registry, { state: "closed" });
    const { spawnFn } = createMockSpawn();
    const mgr = new ParManager({ registry, bus, spawnFn });

    try {
      await mgr.executeInLane("test-lane-1", ["ls"]);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(LaneNotReadyError);
    }
  });

  test("executeInLane rejects on running lane", async () => {
    createLaneInRegistry(registry, { state: "running" });
    const { spawnFn } = createMockSpawn();
    const mgr = new ParManager({ registry, bus, spawnFn });

    try {
      await mgr.executeInLane("test-lane-1", ["ls"]);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(LaneNotReadyError);
    }
  });

  test("executeInLane rejects when no par binding", async () => {
    createLaneInRegistry(registry, { state: "ready" });
    const { spawnFn } = createMockSpawn();
    const mgr = new ParManager({ registry, bus, spawnFn });

    try {
      await mgr.executeInLane("test-lane-1", ["ls"]);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ParNotFoundError);
    }
  });

  test("executeInLane with non-zero exit returns to ready", async () => {
    createLaneInRegistry(registry, { state: "ready" });
    let callCount = 0;
    const spawnFn: SpawnFn = (cmd, opts) => {
      callCount++;
      if (callCount === 1) {
        return createMockSpawn({ pid: 42, exitDelay: 60000 }).spawnFn(cmd, opts);
      }
      return createMockSpawn({ pid: 43, exitCode: 1, stderr: "error" }).spawnFn(cmd, opts);
    };

    const mgr = new ParManager({ registry, bus, spawnFn });
    await mgr.bindParTask("test-lane-1", "/tmp/worktree");
    registry.update("test-lane-1", { state: "ready" });

    const result = await mgr.executeInLane("test-lane-1", ["false"]);
    expect(result.exitCode).toBe(1);
    expect(registry.get("test-lane-1")!.state).toBe("ready");
  });
});

describe("ParManager - T014: Stale detection", () => {
  let registry: LaneRegistry;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    _resetParIdCounter();
    registry = new LaneRegistry();
    bus = new InMemoryLocalBus();
  });

  test("runHealthCheck detects dead process and cleans up", async () => {
    createLaneInRegistry(registry);
    // Use a PID that definitely doesn't exist
    const { spawnFn } = createMockSpawn({ pid: 999999, exitDelay: 60000 });
    const mgr = new ParManager({
      registry,
      bus,
      spawnFn,
      staleTimeoutMs: 50,
      forceKillTimeoutMs: 100,
    });

    await mgr.bindParTask("test-lane-1", "/tmp/worktree");

    await mgr.runHealthCheck();

    // Binding should be cleaned up because PID is dead
    expect(mgr.getBinding("test-lane-1")).toBeUndefined();

    const events = bus.getEvents();
    expect(events.some(e => e.topic === "lane.par_task.terminated")).toBe(true);
  });

  test("runHealthCheck detects stale bindings with alive process", async () => {
    createLaneInRegistry(registry);
    // Use current process PID so isProcessAlive returns true
    const currentPid = process.pid;
    const { spawnFn } = createMockSpawn({ pid: currentPid, exitDelay: 60000 });
    const mgr = new ParManager({
      registry,
      bus,
      spawnFn,
      staleTimeoutMs: 50,
      forceKillTimeoutMs: 100,
    });

    await mgr.bindParTask("test-lane-1", "/tmp/worktree");

    // Wait for heartbeat to go stale
    await new Promise(r => setTimeout(r, 100));

    await mgr.runHealthCheck();

    // Binding should be cleaned up due to stale heartbeat
    expect(mgr.getBinding("test-lane-1")).toBeUndefined();

    const events = bus.getEvents();
    expect(events.some(e => e.topic === "lane.par_task.stale")).toBe(true);
  });

  test("updateHeartbeat prevents stale detection", async () => {
    createLaneInRegistry(registry);
    const currentPid = process.pid;
    const { spawnFn } = createMockSpawn({ pid: currentPid, exitDelay: 60000 });
    const mgr = new ParManager({
      registry,
      bus,
      spawnFn,
      staleTimeoutMs: 100,
      forceKillTimeoutMs: 100,
    });

    await mgr.bindParTask("test-lane-1", "/tmp/worktree");

    // Update heartbeat before stale timeout
    await new Promise(r => setTimeout(r, 50));
    mgr.updateHeartbeat("test-lane-1");

    await mgr.runHealthCheck();

    // Binding should still be active
    const _binding = mgr.getBinding("test-lane-1");
    expect(binding).toBeDefined();
    expect(binding!.status).toBe("active");
  });

  test("getAllBindings returns copies of all bindings", async () => {
    createLaneInRegistry(registry, { laneId: "lane-a" });
    createLaneInRegistry(registry, { laneId: "lane-b" });
    const { spawnFn } = createMockSpawn({ pid: 42, exitDelay: 60000 });
    const mgr = new ParManager({ registry, bus, spawnFn });

    await mgr.bindParTask("lane-a", "/tmp/a");
    await mgr.bindParTask("lane-b", "/tmp/b");

    const bindings = mgr.getAllBindings();
    expect(bindings.length).toBe(2);
  });

  afterEach(() => {
    // No cleanup needed - timer not started in these tests
  });
});

describe("ParManager - T015: Event completeness", () => {
  let registry: LaneRegistry;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    _resetParIdCounter();
    registry = new LaneRegistry();
    bus = new InMemoryLocalBus();
  });

  test("all events include correlationId and timestamp", async () => {
    createLaneInRegistry(registry);
    const { spawnFn } = createMockSpawn({ pid: 42, exitDelay: 60000 });
    const mgr = new ParManager({
      registry,
      bus,
      spawnFn,
      forceKillTimeoutMs: 100,
    });

    await mgr.bindParTask("test-lane-1", "/tmp/worktree");
    await mgr.terminateParTask("test-lane-1");

    const events = bus.getEvents();
    for (const event of events) {
      expect(event.payload!["correlationId"]).toBe("test-lane-1");
      expect(event.payload!["timestamp"]).toBeTruthy();
      expect(event.payload!["laneId"]).toBe("test-lane-1");
      expect(event.payload!["workspaceId"]).toBe("ws-1");
    }
  });

  test("bus failure does not block par operations", async () => {
    createLaneInRegistry(registry);
    const failBus = {
      async publish(): Promise<void> {
        throw new Error("bus down");
      },
      async request(): Promise<any> {
        return {};
      },
    };
    const { spawnFn } = createMockSpawn({ pid: 42, exitDelay: 60000 });
    const mgr = new ParManager({ registry, bus: failBus as any, spawnFn });

    // Should not throw
    const _binding = await mgr.bindParTask("test-lane-1", "/tmp/worktree");
    expect(binding.pid).toBe(42);
  });
});
