import { execCommand } from "../exec";
import type { LaneSpec, ParAdapter } from "./adapter";

export class ParCommandAdapter implements ParAdapter {
  async createLane(spec: LaneSpec): Promise<{ worktreePath: string }> {
    const args = [
      "lane",
      "create",
      "--lane",
      spec.laneId,
      "--repo",
      spec.repoPath,
      "--branch",
      spec.branchName,
    ];
    const result = await execCommand("par", args);
    if (result.code !== 0) throw new Error(`par lane create failed: ${result.stderr}`);
    return { worktreePath: result.stdout.trim() };
  }

  async attachLane(laneId: string): Promise<void> {
    const result = await execCommand("par", ["lane", "attach", "--lane", laneId]);
    if (result.code !== 0) throw new Error(`par lane attach failed: ${result.stderr}`);
  }

  async cleanupLane(laneId: string): Promise<void> {
    const result = await execCommand("par", ["lane", "cleanup", "--lane", laneId]);
    if (result.code !== 0) throw new Error(`par lane cleanup failed: ${result.stderr}`);
  }
}
