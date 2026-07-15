// T018 - Integration tests for full lane lifecycle with real git repos
// (FR-008-001, FR-008-002, FR-008-004, FR-008-005, FR-008-007)
// Traces to: FR-LAN-002 (provision git worktree), FR-LAN-003 (bind to par task),
// FR-LAN-004 (publish lane lifecycle events), FR-LAN-005 (cleanup on closed),
// FR-LAN-006 (gracefully terminate PTYs)

import * as fs from "node:fs";
import * as path from "node:path";
import {
  _resetIdCounter,
  LaneManager,
  ParManager,
  type PtyManager,
  type SpawnFn,
} from "../../../src/lanes/index.js";
import { computeBranchName } from "../../../src/lanes/worktree.js";

import { InMemoryLocalBus } from "../../../src/protocol/bus.js";

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeoutMs = 30_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      proc.kill(9);
      reject(new Error(`git ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
      timedOut,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
  return stdout.trim();
}

async function createTempRepo(): Promise<string> {
  const tmpDir = path.join(
    (await import("node:os")).tmpdir(),
    `helios-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  fs.mkdirSync(tmpDir, { recursive: true });
  await runGit(["init", "-b", "main"], tmpDir);
  await runGit(["config", "user.email", "test@test.com"], tmpDir);
  await runGit(["config", "user.name", "Test"], tmpDir);
  fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test Repo\n");
  await runGit(["add", "."], tmpDir);
  await runGit(["commit", "-m", "initial commit"], tmpDir);
  return tmpDir;
}

function cleanupDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("Lane Lifecycle Integration (FR-008-001, FR-008-002)", () => {
  let repoDir: string;
  let bus: InMemoryLocalBus;
  let mgr: LaneManager;

  beforeEach(async () => {
    _resetIdCounter();
    repoDir = await createTempRepo();
    bus = new InMemoryLocalBus();
    mgr = new LaneManager({ bus, capacityLimit: 50 });
  });

  afterEach(() => {
    cleanupDir(repoDir);
  });

  test("create + provision: worktree exists on disk and branch created", async () => {
    const lane = await mgr.create("ws-int", "main");
    expect(lane.state).toBe("provisioning");

    const provisioned = await mgr.provision(lane.laneId, repoDir);
    expect(provisioned.state).toBe("ready");
    expect(provisioned.worktreePath).toBeTruthy();

    // Verify worktree exists on disk
    expect(fs.existsSync(provisioned.worktreePath!)).toBe(true);

    // Verify branch was created
    const branchName = computeBranchName(lane.laneId);
    const branches = await runGit(["branch", "--list", branchName], repoDir);
    expect(branches).toContain(branchName);
  });

  test("execute command in lane worktree context", async () => {
    const lane = await mgr.create("ws-int", "main");
    const provisioned = await mgr.provision(lane.laneId, repoDir);
    const worktreePath = provisioned.worktreePath!;

    // Write a file in the worktree
    fs.writeFileSync(path.join(worktreePath, "test-output.txt"), "hello from lane\n");
    expect(fs.existsSync(path.join(worktreePath, "test-output.txt"))).toBe(true);

    // Verify file is NOT in main worktree
    expect(fs.existsSync(path.join(repoDir, "test-output.txt"))).toBe(false);

    await mgr.cleanup(lane.laneId);
  });

  test("cleanup removes worktree directory and branch", async () => {
    const lane = await mgr.create("ws-int", "main");
    const provisioned = await mgr.provision(lane.laneId, repoDir);
    const worktreePath = provisioned.worktreePath!;
    const branchName = computeBranchName(lane.laneId);

    await mgr.cleanup(lane.laneId);

    // Worktree directory removed
    expect(fs.existsSync(worktreePath)).toBe(false);

    // Branch deleted
    const branches = await runGit(["branch", "--list", branchName], repoDir);
    expect(branches).toBe("");

    // Lane record is closed
    const closed = mgr.getRegistry().get(lane.laneId);
    expect(closed!.state).toBe("closed");
  });

  test("cleanup terminates the par task and PTYs before deleting the worktree", async () => {
    let worktreePath = "";
    let parManager: ParManager | undefined;
    let resolveExit: ((code: number) => void) | undefined;
    const cleanupOrder: string[] = [];
    const kills: number[] = [];
    const exited = new Promise<number>(resolve => {
      resolveExit = resolve;
    });
    const spawnFn: SpawnFn = () => ({
      pid: 4242,
      stdout: null,
      stderr: null,
      exited,
      kill(signal?: number) {
        expect(fs.existsSync(worktreePath)).toBe(true);
        kills.push(signal ?? 15);
        cleanupOrder.push("par-terminated");
        resolveExit?.(0);
      },
    });
    const ptyManager: PtyManager = {
      getByLane: laneId => [{ ptyId: "pty-cleanup", laneId }],
      terminate: async () => {
        expect(fs.existsSync(worktreePath)).toBe(true);
        cleanupOrder.push("pty-terminated");
      },
    };

    mgr = new LaneManager({
      bus,
      ptyManager,
      ptyTerminationTimeoutMs: 100,
      parTerminationTimeoutMs: 100,
      parTaskManagerFactory: registry => {
        parManager = new ParManager({ registry, bus, spawnFn, forceKillTimeoutMs: 50 });
        return parManager;
      },
    });
    const lane = await mgr.create("ws-int", "main");
    const provisioned = await mgr.provision(lane.laneId, repoDir);
    worktreePath = provisioned.worktreePath!;
    await parManager!.bindParTask(lane.laneId, worktreePath);

    await mgr.cleanup(lane.laneId);

    expect(cleanupOrder).toEqual(["par-terminated", "pty-terminated"]);
    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(kills).toEqual([15]);
    expect(parManager!.getBinding(lane.laneId)).toBeUndefined();
    expect(mgr.getRegistry().get(lane.laneId)?.parTaskPid).toBeNull();

    // Closing an already closed lane is a true no-op and cannot re-signal resources.
    await mgr.cleanup(lane.laneId);
    expect(kills).toEqual([15]);

    const topics = bus.getEvents().map(event => event.topic);
    expect(topics).toContain("lane.par_task.terminated");
    expect(topics).toContain("lane.ptys_terminated");
    expect(topics).toContain("lane.worktree.removed");
    expect(topics.indexOf("lane.par_task.terminated")).toBeLessThan(
      topics.indexOf("lane.ptys_terminated")
    );
    expect(topics.indexOf("lane.ptys_terminated")).toBeLessThan(
      topics.indexOf("lane.worktree.removed")
    );
  });

  test("sharing: two agents can attach and detach", async () => {
    const lane = await mgr.create("ws-int", "main");
    await mgr.provision(lane.laneId, repoDir);

    await mgr.share(lane.laneId);
    expect(mgr.getRegistry().get(lane.laneId)!.state).toBe("shared");

    await mgr.attach(lane.laneId, "agent-1");
    await mgr.attach(lane.laneId, "agent-2");
    expect(mgr.getRegistry().get(lane.laneId)!.attachedAgents.length).toBe(2);

    await mgr.detach(lane.laneId, "agent-1");
    await mgr.detach(lane.laneId, "agent-2");
    // After last agent detaches from shared, transitions to ready
    expect(mgr.getRegistry().get(lane.laneId)!.state).toBe("ready");

    await mgr.cleanup(lane.laneId);
  });

  test("bus events published for each transition (FR-008-004)", async () => {
    const lane = await mgr.create("ws-int", "main");
    await mgr.provision(lane.laneId, repoDir);
    await mgr.cleanup(lane.laneId);

    const events = bus.getEvents();
    const topics = events.map(e => e.topic);

    expect(topics).toContain("lane.created");
    expect(topics).toContain("lane.state.changed");
    expect(topics).toContain("lane.cleaning");
    expect(topics).toContain("lane.closed");

    // All events have workspace correlation
    for (const evt of events) {
      if (evt.topic?.startsWith("lane.")) {
        expect(evt.lane_id).toBe(lane.laneId);
      }
    }
  });

  test("cleanup is idempotent", async () => {
    const lane = await mgr.create("ws-int", "main");
    await mgr.provision(lane.laneId, repoDir);
    await mgr.cleanup(lane.laneId);
    // Second cleanup should not throw
    await mgr.cleanup(lane.laneId);
    expect(mgr.getRegistry().get(lane.laneId)!.state).toBe("closed");
  });
});
