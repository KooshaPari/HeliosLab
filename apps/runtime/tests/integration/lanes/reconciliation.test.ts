/**
 * FR-HELIOS-084: Orphan Reconciliation Integration Tests
 * Verifies: FR-LAN-008 (Orphan lane reconciliation on startup), FR-ORF-001 (Orphan detection)
 */
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
  await proc.exited;
  return stdout.trim();
}

async function createTempRepo(): Promise<string> {
  const tmpDir = path.join(
    (await import("node:os")).tmpdir(),
    `helios-recon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
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

describe("Orphan Reconciliation Integration (FR-008-008, SC-008-004)", () => {
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

  test("detects and removes orphaned worktree directory", async () => {
    // Create an orphaned worktree directory (no registry entry)
    const orphanDir = path.join(repoDir, ".helios-worktrees", "fake-orphan-lane");
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "stale.txt"), "stale");

    const result = await mgr.reconcileOrphans(repoDir);

    expect(result.orphanedWorktrees).toBe(1);
    expect(result.totalCleaned).toBeGreaterThanOrEqual(1);
    // Directory should be removed
    expect(fs.existsSync(orphanDir)).toBe(false);
  });

  test("detects and closes orphaned registry record (worktree missing)", async () => {
    // Create a lane, provision it, then delete the worktree directory manually
    const lane = await mgr.create("ws-recon", "main");
    const provisioned = await mgr.provision(lane.laneId, repoDir);
    const worktreePath = provisioned.worktreePath!;

    // Simulate crash: delete worktree directory but leave registry entry
    fs.rmSync(worktreePath, { recursive: true, force: true });

    const result = await mgr.reconcileOrphans(repoDir);

    expect(result.orphanedRecords).toBe(1);
    // Lane should now be closed
    expect(mgr.getRegistry().get(lane.laneId)!.state).toBe("closed");
  });

  test("handles both orphan types simultaneously", async () => {
    // Orphaned worktree directory
    const orphanDir = path.join(repoDir, ".helios-worktrees", "orphan-wt-both");
    fs.mkdirSync(orphanDir, { recursive: true });

    // Orphaned registry entry (create lane, provision, delete worktree)
    const lane = await mgr.create("ws-recon", "main");
    const provisioned = await mgr.provision(lane.laneId, repoDir);
    fs.rmSync(provisioned.worktreePath!, { recursive: true, force: true });

    const result = await mgr.reconcileOrphans(repoDir);

    expect(result.orphanedWorktrees).toBeGreaterThanOrEqual(1);
    expect(result.orphanedRecords).toBeGreaterThanOrEqual(1);
    expect(result.totalCleaned).toBeGreaterThanOrEqual(2);
  });

  test("publishes reconciliation.completed event with correct counts", async () => {
    const orphanDir = path.join(repoDir, ".helios-worktrees", "orphan-evt");
    fs.mkdirSync(orphanDir, { recursive: true });

    await mgr.reconcileOrphans(repoDir);

    const events = bus.getEvents();
    const reconEvent = events.find(e => e.topic === "reconciliation.completed");
    expect(reconEvent).toBeDefined();
    expect(reconEvent!.payload!["orphanedWorktrees"]).toBe(1);
    expect(reconEvent!.payload!["totalCleaned"]).toBeGreaterThanOrEqual(1);
  });

  test("completes within 30 seconds (SC-008-004)", async () => {
    // Create a few orphaned directories
    for (let i = 0; i < 5; i++) {
      const dir = path.join(repoDir, ".helios-worktrees", `orphan-perf-${i}`);
      fs.mkdirSync(dir, { recursive: true });
    }

    const start = Date.now();
    const result = await mgr.reconcileOrphans(repoDir, { timeoutMs: 30_000 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(30_000);
    expect(result.timedOut).toBe(false);
    expect(result.orphanedWorktrees).toBe(5);
  });

  test("no orphans: reconciliation is near-instant", async () => {
    const start = Date.now();
    const result = await mgr.reconcileOrphans(repoDir);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1_000);
    expect(result.orphanedWorktrees).toBe(0);
    expect(result.orphanedRecords).toBe(0);
    expect(result.totalCleaned).toBe(0);
  });

  test("no stale state after reconciliation", async () => {
    // Create orphans
    const orphanDir = path.join(repoDir, ".helios-worktrees", "stale-check");
    fs.mkdirSync(orphanDir, { recursive: true });

    const lane = await mgr.create("ws-recon", "main");
    const provisioned = await mgr.provision(lane.laneId, repoDir);
    fs.rmSync(provisioned.worktreePath!, { recursive: true, force: true });

    await mgr.reconcileOrphans(repoDir);

    // Verify: no active lanes with missing worktrees
    const active = mgr.getRegistry().getActive();
    for (const l of active) {
      if (l.worktreePath) {
        expect(fs.existsSync(l.worktreePath)).toBe(true);
      }
    }

    // Verify: no orphaned worktree directories
    const worktreeRoot = path.join(repoDir, ".helios-worktrees");
    if (fs.existsSync(worktreeRoot)) {
      const entries = fs.readdirSync(worktreeRoot);
      const activeLaneIds = new Set(active.map(l => l.laneId));
      for (const entry of entries) {
        expect(activeLaneIds.has(entry)).toBe(true);
      }
    }
  });
});
