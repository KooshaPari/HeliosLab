// T020 - Stress test for concurrent lane operations (50 lanes)
// (NFR-008-003, SC-008-002)

import * as fs from "node:fs";
import * as path from "node:path";
import { _resetIdCounter, LaneManager } from "../../../src/lanes/index.js";
import { LaneCapacityExceededError } from "../../../src/lanes/registry.js";
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
    `helios-stress-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  fs.mkdirSync(tmpDir, { recursive: true });
  await runGit(["init", "-b", "main"], tmpDir);
  await runGit(["config", "user.email", "test@test.com"], tmpDir);
  await runGit(["config", "user.name", "Test"], tmpDir);
  fs.writeFileSync(path.join(tmpDir, "file.txt"), "content\n");
  await runGit(["add", "."], tmpDir);
  await runGit(["commit", "-m", "initial"], tmpDir);
  return tmpDir;
}

function cleanupDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("Concurrent Lane Stress Test (NFR-008-003)", () => {
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

  test("50 concurrent lanes: create, provision, verify, cleanup", async () => {
    const LANE_COUNT = 50;
    const _startTime = Date.now();

    // Step 1: Create 50 lanes concurrently
    const createPromises = Array.from({ length: LANE_COUNT }, (_,_i) =>
      mgr.create(`ws-stress`, "main")
    );
    const lanes = await Promise.all(createPromises);
    expect(lanes.length).toBe(LANE_COUNT);

    // Step 2: Provision all 50 lanes - must be sequential for git worktree
    // (git worktree add has a lock file that prevents true concurrency)
    const provisionedLanes = [];
    for (const lane of lanes) {
      const provisioned = await mgr.provision(lane.laneId, repoDir);
      provisionedLanes.push(provisioned);
    }

    // Step 3: Verify all 50 lanes reach ready state
    for (const lane of provisionedLanes) {
      expect(lane.state).toBe("ready");
      expect(lane.worktreePath).toBeTruthy();
      expect(fs.existsSync(lane.worktreePath!)).toBe(true);
    }

    // Step 4: Execute a simple operation in each lane
    for (const lane of provisionedLanes) {
      fs.writeFileSync(path.join(lane.worktreePath!, "stress-output.txt"), `lane-${lane.laneId}\n`);
    }

    // Step 5: Cleanup all 50 lanes (sequentially to avoid git lock contention)
    for (const lane of provisionedLanes) {
      await mgr.cleanup(lane.laneId);
    }

    // Step 6: Verify zero orphans
    const worktreeRoot = path.join(repoDir, ".helios-worktrees");
    if (fs.existsSync(worktreeRoot)) {
      const remaining = fs.readdirSync(worktreeRoot);
      expect(remaining.length).toBe(0);
    }

    // Verify all lane records are closed
    const allLanes = mgr.list();
    for (const lane of allLanes) {
      expect(lane.state).toBe("closed");
    }

    // Verify no active lanes remain
    expect(mgr.getRegistry().getActive().length).toBe(0);

    const totalTime = Date.now() - startTime;
    console.log(`50-lane stress cycle completed in ${totalTime}ms`);
  }, 120_000);

  test("lane 51 rejected at capacity (NFR-008-003)", async () => {
    // Create exactly 50 lanes
    for (let i = 0; i < 50; i++) {
      await mgr.create("ws-cap", "main");
    }

    // Lane 51 should be rejected
    try {
      await mgr.create("ws-cap", "main");
      expect(true).toBe(false); // should not reach
     // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      expect(e).toBeInstanceOf(LaneCapacityExceededError);
    }
  });

  test("capacity freed after cleanup allows new lanes", async () => {
    // Fill to capacity
    const lanes = [];
    for (let i = 0; i < 50; i++) {
      lanes.push(await mgr.create("ws-free", "main"));
    }

    // Cleanup one lane
    mgr.getRegistry().update(lanes[0]!.laneId, { state: "ready" });
    await mgr.cleanup(lanes[0]!.laneId);

    // Should now be able to create another
    const newLane = await mgr.create("ws-free", "main");
    expect(newLane.laneId).toBeTruthy();
  });
});
