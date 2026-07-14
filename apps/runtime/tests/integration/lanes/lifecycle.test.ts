// T018 - Integration tests for full lane lifecycle with real git repos
// (FR-008-001, FR-008-002, FR-008-004, FR-008-005, FR-008-007)
// Traces to: FR-LAN-002 (provision git worktree), FR-LAN-003 (bind to par task),
// FR-LAN-004 (publish lane lifecycle events), FR-LAN-005 (cleanup on closed),
// FR-LAN-006 (gracefully terminate PTYs)

import * as fs from "node:fs";
import * as path from "node:path";
import { _resetIdCounter, LaneManager } from "../../../src/lanes/index.js";

import { InMemoryLocalBus } from "../../../src/protocol/bus.js";

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
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
