// T006, T007, T010 - Git worktree provisioning, cleanup, and partial failure handling

import * as path from "node:path";
import * as fs from "node:fs";

// ── Constants ────────────────────────────────────────────────────────────────

const WORKTREE_DIR = ".helios-worktrees";
const BRANCH_PREFIX = "helios/lane/";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorktreeOptions {
  workspaceRepoPath: string;
  laneId: string;
  baseBranch: string;
}

export interface WorktreeResult {
  worktreePath: string;
  branchName: string;
  createdAt: Date;
}

export interface WorktreeLatencyMetrics {
  provisionMs?: number;
  cleanupMs?: number;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class WorktreeProvisionError extends Error {
  constructor(
    public readonly laneId: string,
    public readonly stderr: string
  ) {
    super(`Worktree provisioning failed for lane ${laneId}: ${stderr}`);
    this.name = "WorktreeProvisionError";
  }
}

export class WorktreeCleanupError extends Error {
  constructor(
    public readonly worktreePath: string,
    public readonly reason: string
  ) {
    super(`Worktree cleanup failed for ${worktreePath}: ${reason}`);
    this.name = "WorktreeCleanupError";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function computeWorktreePath(workspaceRepoPath: string, laneId: string): string {
  return path.join(workspaceRepoPath, WORKTREE_DIR, laneId);
}

export function computeBranchName(laneId: string): string {
  return `${BRANCH_PREFIX}${laneId}`;
}

type SpawnResult = {
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  readonly pid: number;
};

type SpawnOptions = {
  cwd?: string;
  stdout?: "pipe" | "inherit" | "ignore";
  stderr?: "pipe" | "inherit" | "ignore";
  stdin?: "pipe" | "inherit" | "ignore";
  env?: Record<string, string>;
};

const spawn: (command: string[], options: SpawnOptions) => SpawnResult =
  (
    (globalThis as Record<string, unknown>).Bun as
      | {
          spawn: (command: string[], options: SpawnOptions) => SpawnResult;
        }
      | undefined
  )?.spawn ??
  ((() => {
    throw new Error("worktree module requires Bun runtime");
  }) as (command: string[], options: SpawnOptions) => SpawnResult);

async function runGit(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ── T006: Provision Worktree ─────────────────────────────────────────────────

export async function provisionWorktree(options: WorktreeOptions): Promise<WorktreeResult> {
  const { workspaceRepoPath, laneId, baseBranch } = options;
  const worktreePath = computeWorktreePath(workspaceRepoPath, laneId);
  const branchName = computeBranchName(laneId);
  const start = performance.now();

  // If worktree path already exists (stale from previous crash), remove it first
  if (fs.existsSync(worktreePath)) {
    await forceRemoveWorktreeDir(worktreePath, workspaceRepoPath);
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(worktreePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Create worktree with new branch
  const result = await runGit(
    ["worktree", "add", "-b", branchName, worktreePath, baseBranch],
    workspaceRepoPath
  );

  if (result.exitCode !== 0) {
    // T010: Clean up partial state on failure
    await cleanupPartialProvision(worktreePath, branchName, workspaceRepoPath);
    throw new WorktreeProvisionError(laneId, result.stderr);
  }

  // Verify the worktree directory exists
  if (!fs.existsSync(worktreePath)) {
    await cleanupPartialProvision(worktreePath, branchName, workspaceRepoPath);
    throw new WorktreeProvisionError(laneId, "Worktree directory not found after creation");
  }

  const elapsed = performance.now() - start;
  lastMetrics.provisionMs = elapsed;

  return {
    worktreePath,
    branchName,
    createdAt: new Date(),
  };
}

// ── T007: Remove Worktree ────────────────────────────────────────────────────

export async function removeWorktree(
  worktreePath: string,
  workspaceRepoPath: string
): Promise<void> {
  const start = performance.now();

  // Extract lane ID from path to compute branch name
  const laneId = path.basename(worktreePath);
  const branchName = computeBranchName(laneId);

  // Try git worktree remove --force
  const _removeResult = await runGit(
    ["worktree", "remove", worktreePath, "--force"],
    workspaceRepoPath
  );

  // Fallback: force-delete directory if still exists
  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  // Prune stale references
  await runGit(["worktree", "prune"], workspaceRepoPath);

  // Delete the lane branch (best-effort)
  const branchResult = await runGit(["branch", "-D", branchName], workspaceRepoPath);
  if (branchResult.exitCode !== 0 && !branchResult.stderr.includes("not found")) {
    // Log warning but continue - branch may have been manually deleted
  }

  // Verify cleanup
  if (fs.existsSync(worktreePath)) {
    throw new WorktreeCleanupError(worktreePath, "Directory still exists after cleanup");
  }

  const elapsed = performance.now() - start;
  lastMetrics.cleanupMs = elapsed;
}

// ── T010: Partial Provisioning Cleanup ───────────────────────────────────────

async function cleanupPartialProvision(
  worktreePath: string,
  branchName: string,
  workspaceRepoPath: string
): Promise<void> {
  // Remove partially created worktree directory
  if (fs.existsSync(worktreePath)) {
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // Best effort - log in production
    }
  }

  // Remove partially created branch
  await runGit(["branch", "-D", branchName], workspaceRepoPath);

  // Prune worktree references
  await runGit(["worktree", "prune"], workspaceRepoPath);
}

async function forceRemoveWorktreeDir(
  worktreePath: string,
  workspaceRepoPath: string
): Promise<void> {
  // Try git worktree remove first
  await runGit(["worktree", "remove", worktreePath, "--force"], workspaceRepoPath);

  // Fallback
  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  await runGit(["worktree", "prune"], workspaceRepoPath);
}

// ── T009: Orphan Detection ───────────────────────────────────────────────────

export interface ReconciliationResult {
  orphanedWorktrees: number;
  orphanedRecords: number;
  cleaned: number;
}

export async function reconcileOrphanedWorktrees(
  workspaceRepoPath: string,
  knownLaneIds: Set<string>,
  _closeLaneRecord: (laneId: string) => void
): Promise<ReconciliationResult> {
  const worktreeRoot = path.join(workspaceRepoPath, WORKTREE_DIR);
  const result: ReconciliationResult = {
    orphanedWorktrees: 0,
    orphanedRecords: 0,
    cleaned: 0,
  };

  // Scan for orphaned worktree directories
  if (fs.existsSync(worktreeRoot)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(worktreeRoot, { withFileTypes: true });
    } catch {
      // Permissions error - return partial
      return result;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const laneId = entry.name;
      if (!knownLaneIds.has(laneId)) {
        result.orphanedWorktrees++;
        const worktreePath = path.join(worktreeRoot, laneId);
        try {
          await removeWorktree(worktreePath, workspaceRepoPath);
          result.cleaned++;
        } catch {
          // Best effort cleanup
        }
      }
    }
  }

  // Check for lane records without worktrees (caller provides the close callback)
  // This is handled by the caller passing known lane IDs and a close callback
  // The caller iterates its records and checks if worktree dirs exist

  return result;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export const lastMetrics: WorktreeLatencyMetrics = {};

export function resetMetrics(): void {
  delete lastMetrics.provisionMs;
  delete lastMetrics.cleanupMs;
}
