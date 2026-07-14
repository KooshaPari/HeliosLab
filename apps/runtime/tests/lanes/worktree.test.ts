/**
 * FR-HELIOS-099: Worktree Provisioning and Orphan Reconciliation
 * Verifies: FR-LAN-006 (Worktree provisioning), FR-LAN-009 (Orphan detection)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  provisionWorktree,
  removeWorktree,
  reconcileOrphanedWorktrees,
  computeWorktreePath,
  computeBranchName,
  WorktreeProvisionError,
  resetMetrics,
  lastMetrics,
} from "../../src/lanes/worktree.js";
import { LaneManager, _resetIdCounter } from "../../src/lanes/index.js";

import { InMemoryLocalBus } from "../../src/protocol/bus.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

function createTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helios-wt-test-"));
  tmpDirs.push(dir);

  // Initialize a git repo with an initial commit
  Bun.spawnSync(["git", "init"], { cwd: dir });
  Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: dir });
  Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "# test repo\n");
  Bun.spawnSync(["git", "add", "."], { cwd: dir });
  Bun.spawnSync(["git", "commit", "-m", "initial"], { cwd: dir });

  return dir;
}

function cleanup(): void {
  for (const dir of tmpDirs) {
    try {
      // Prune worktrees first to avoid locked file issues
      Bun.spawnSync(["git", "worktree", "prune"], { cwd: dir });
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      // ignore
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    // eslint-disable-next-line no-unused-vars
    } catch (_err) {
      // ignore
    }
  }
  tmpDirs = [];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Worktree helpers", () => {
  test("computeWorktreePath joins correctly", () => {
    expect(computeWorktreePath("/repo", "lane_1")).toBe("/repo/.helios-worktrees/lane_1");
  });

  test("computeBranchName prefixes correctly", () => {
    expect(computeBranchName("lane_1")).toBe("helios/lane/lane_1");
  });
});

describe("T006 - provisionWorktree", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(cleanup);

  test("creates worktree directory and branch", async () => {
    const repo = createTempGitRepo();
    const result = await provisionWorktree({
      workspaceRepoPath: repo,
      laneId: "lane_test_1",
      baseBranch: "main",
    });

    expect(result.worktreePath).toBe(computeWorktreePath(repo, "lane_test_1"));
    expect(result.branchName).toBe("helios/lane/lane_test_1");
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(fs.existsSync(result.worktreePath)).toBe(true);

    // Verify branch exists
    const branches = Bun.spawnSync(["git", "branch", "--list", result.branchName], { cwd: repo });
    const branchOutput = new TextDecoder().decode(branches.stdout).trim();
    expect(branchOutput).toContain("helios/lane/lane_test_1");
  });

  test("records provisioning latency", async () => {
    const repo = createTempGitRepo();
    await provisionWorktree({
      workspaceRepoPath: repo,
      laneId: "lane_latency",
      baseBranch: "main",
    });

    expect(lastMetrics.provisionMs).toBeDefined();
    expect(lastMetrics.provisionMs!).toBeGreaterThan(0);
  });

  test("throws WorktreeProvisionError for invalid base branch", async () => {
    const repo = createTempGitRepo();
    await expect(
      provisionWorktree({
        workspaceRepoPath: repo,
        laneId: "lane_bad_base",
        baseBranch: "nonexistent-branch",
      })
    ).rejects.toThrow(WorktreeProvisionError);
  });

  test("removes stale worktree path before provisioning", async () => {
    const repo = createTempGitRepo();
    const stalePath = computeWorktreePath(repo, "lane_stale");
    fs.mkdirSync(stalePath, { recursive: true });
    fs.writeFileSync(path.join(stalePath, "stale.txt"), "stale");

    const result = await provisionWorktree({
      workspaceRepoPath: repo,
      laneId: "lane_stale",
      baseBranch: "main",
    });

    expect(fs.existsSync(result.worktreePath)).toBe(true);
    // stale.txt should be gone, replaced by actual worktree content
    expect(fs.existsSync(path.join(result.worktreePath, "stale.txt"))).toBe(false);
    expect(fs.existsSync(path.join(result.worktreePath, "README.md"))).toBe(true);
  });
});

describe("T007 - removeWorktree", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(cleanup);

  test("removes worktree directory and branch", async () => {
    const repo = createTempGitRepo();
    const result = await provisionWorktree({
      workspaceRepoPath: repo,
      laneId: "lane_remove",
      baseBranch: "main",
    });

    expect(fs.existsSync(result.worktreePath)).toBe(true);

    await removeWorktree(result.worktreePath, repo);

    expect(fs.existsSync(result.worktreePath)).toBe(false);
    expect(lastMetrics.cleanupMs).toBeDefined();
    expect(lastMetrics.cleanupMs!).toBeGreaterThan(0);
  });

  test("idempotent removal of already-removed worktree", async () => {
    const repo = createTempGitRepo();
    const result = await provisionWorktree({
      workspaceRepoPath: repo,
      laneId: "lane_idem",
      baseBranch: "main",
    });

    await removeWorktree(result.worktreePath, repo);
    // Second removal should not throw
    await removeWorktree(result.worktreePath, repo);
  });
});

describe("T008 - PTY termination during cleanup", () => {
  afterEach(cleanup);

  test("terminates PTYs before worktree removal", async () => {
    _resetIdCounter();
    const terminated: string[] = [];
    const mockPtyManager: PtyManager = {
      getByLane: (laneId: string) => [
        { ptyId: "pty1", laneId },
        { ptyId: "pty2", laneId },
      ],
      terminate: async (ptyId: string) => {
        terminated.push(ptyId);
      },
    };

    const bus = new InMemoryLocalBus();
    const mgr = new LaneManager({ bus, ptyManager: mockPtyManager });
    const lane = await mgr.create("ws-1", "main");

    // Move to ready state for cleanup
    mgr.getRegistry().update(lane.laneId, { state: "ready" });

    await mgr.cleanup(lane.laneId);

    expect(terminated).toContain("pty1");
    expect(terminated).toContain("pty2");

    const events = bus.getEvents();
    const ptyEvent = events.find(e => e.topic === "lane.ptys_terminated");
    expect(ptyEvent).toBeDefined();
  });

  test("cleanup proceeds when ptyManager is null", async () => {
    _resetIdCounter();
    const bus = new InMemoryLocalBus();
    const mgr = new LaneManager({ bus, ptyManager: null });
    const lane = await mgr.create("ws-1", "main");
    mgr.getRegistry().update(lane.laneId, { state: "ready" });

    // Should not throw
    await mgr.cleanup(lane.laneId);
    const updated = mgr.getRegistry().get(lane.laneId);
    expect(updated?.state).toBe("closed");
  });

  test("cleanup proceeds when ptyManager.getByLane throws", async () => {
    _resetIdCounter();
    const mockPtyManager: PtyManager = {
      getByLane: () => {
        throw new Error("PTY manager down");
      },
      terminate: async () => {},
    };

    const mgr = new LaneManager({ bus: null, ptyManager: mockPtyManager });
    const lane = await mgr.create("ws-1", "main");
    mgr.getRegistry().update(lane.laneId, { state: "ready" });

    await mgr.cleanup(lane.laneId);
    const updated = mgr.getRegistry().get(lane.laneId);
    expect(updated?.state).toBe("closed");
  });
});

describe("T009 - Orphan reconciliation", () => {
  afterEach(cleanup);

  test("detects and removes orphaned worktree directories", async () => {
    const repo = createTempGitRepo();
    const orphanDir = path.join(repo, ".helios-worktrees", "orphan_lane");
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "file.txt"), "orphan");

    const knownLanes = new Set<string>();
    const result = await reconcileOrphanedWorktrees(repo, knownLanes, () => {});

    expect(result.orphanedWorktrees).toBe(1);
    expect(result.cleaned).toBe(1);
    expect(fs.existsSync(orphanDir)).toBe(false);
  });

  test("skips known lanes during reconciliation", async () => {
    const repo = createTempGitRepo();
    const result = await provisionWorktree({
      workspaceRepoPath: repo,
      laneId: "known_lane",
      baseBranch: "main",
    });

    const knownLanes = new Set(["known_lane"]);
    const reconcileResult = await reconcileOrphanedWorktrees(repo, knownLanes, () => {});

    expect(reconcileResult.orphanedWorktrees).toBe(0);
    expect(fs.existsSync(result.worktreePath)).toBe(true);

    // cleanup
    await removeWorktree(result.worktreePath, repo);
  });

  test("handles missing worktree root gracefully", async () => {
    const repo = createTempGitRepo();
    // No .helios-worktrees directory
    const result = await reconcileOrphanedWorktrees(repo, new Set(), () => {});
    expect(result.orphanedWorktrees).toBe(0);
  });
});

describe("T010 - Partial provisioning failure", () => {
  afterEach(cleanup);

  test("provision method cleans up on failure and transitions to closed", async () => {
    _resetIdCounter();
    const bus = new InMemoryLocalBus();
    const mgr = new LaneManager({ bus });
    const lane = await mgr.create("ws-1", "main");

    // Try to provision with a non-existent repo path
    await expect(mgr.provision(lane.laneId, "/nonexistent/repo/path")).rejects.toThrow();

    const updated = mgr.getRegistry().get(lane.laneId);
    expect(updated?.state).toBe("closed");

    const events = bus.getEvents();
    const failEvent = events.find(e => e.topic === "lane.provision_failed");
    expect(failEvent).toBeDefined();
  });

  test("provision succeeds with real git repo", async () => {
    _resetIdCounter();
    const repo = createTempGitRepo();
    const bus = new InMemoryLocalBus();
    const mgr = new LaneManager({ bus });
    const lane = await mgr.create("ws-1", "main");

    const provisioned = await mgr.provision(lane.laneId, repo);

    expect(provisioned.state).toBe("ready");
    expect(provisioned.worktreePath).toBeTruthy();
    expect(fs.existsSync(provisioned.worktreePath!)).toBe(true);

    // Cleanup
    await mgr.cleanup(provisioned.laneId);
  });
});

describe("LaneManager.reconcileOrphans (T009 integration)", () => {
  afterEach(cleanup);

  test("reconciles orphaned directories and records", async () => {
    _resetIdCounter();
    const repo = createTempGitRepo();
    const mgr = new LaneManager({ bus: null });

    // Create an orphan directory
    const orphanDir = path.join(repo, ".helios-worktrees", "orphan_x");
    fs.mkdirSync(orphanDir, { recursive: true });

    const result = await mgr.reconcileOrphans(repo);
    expect(result.orphanedWorktrees).toBe(1);
    expect(result.cleaned).toBe(1);
  });
});
