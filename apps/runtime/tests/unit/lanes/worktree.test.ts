/**
 * FR-HELIOS-042: Worktree Operations Tests
 * Verifies: FR-LAN-002 (Git worktree provisioning)
 */
import { describe, test, expect } from "bun:test";
import { computeWorktreePath, computeBranchName } from "../../../src/lanes/worktree.js";

describe("Worktree Utilities (FR-008-002)", () => {
  test("computeWorktreePath builds correct path", () => {
    const result = computeWorktreePath("/workspace/repo", "lane-abc");
    expect(result).toBe("/workspace/repo/.helios-worktrees/lane-abc");
  });

  test("computeBranchName uses correct prefix", () => {
    const result = computeBranchName("lane-xyz");
    expect(result).toBe("helios/lane/lane-xyz");
  });

  test("computeWorktreePath handles trailing slashes", () => {
    // path.join normalizes trailing slashes
    const result = computeWorktreePath("/workspace/repo/", "lane-1");
    expect(result).toContain(".helios-worktrees/lane-1");
  });
});
