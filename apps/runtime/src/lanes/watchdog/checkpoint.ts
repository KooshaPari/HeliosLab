// T001 - Watchdog checkpoint persistence for crash recovery

import { promises as fs } from "fs";
import path from "path";
import os from "os";

export interface WatchdogCheckpoint {
  cycleNumber: number;
  lastCycleTimestamp: string;
  orphanCount: number;
  detectionSummary: {
    worktrees: number;
    zellijSessions: number;
    ptyProcesses: number;
  };
}

export function isWatchdogCheckpoint(value: unknown): value is WatchdogCheckpoint {
  if (typeof value !== "object" || value === null) return false;

  const checkpoint = value as Partial<WatchdogCheckpoint>;
  const summary = checkpoint.detectionSummary;
  return (
    typeof checkpoint.cycleNumber === "number" &&
    Number.isInteger(checkpoint.cycleNumber) &&
    checkpoint.cycleNumber >= 0 &&
    typeof checkpoint.lastCycleTimestamp === "string" &&
    !Number.isNaN(Date.parse(checkpoint.lastCycleTimestamp)) &&
    typeof checkpoint.orphanCount === "number" &&
    Number.isInteger(checkpoint.orphanCount) &&
    checkpoint.orphanCount >= 0 &&
    typeof summary === "object" &&
    summary !== null &&
    [summary.worktrees, summary.zellijSessions, summary.ptyProcesses].every(
      count => typeof count === "number" && Number.isInteger(count) && count >= 0
    )
  );
}

export class CheckpointManager {
  private readonly checkpointPath: string;

  constructor(baseDir?: string) {
    const heliosDataDir = baseDir ?? path.join(os.homedir(), ".helios", "data");
    this.checkpointPath = path.join(heliosDataDir, "watchdog_checkpoint.json");
  }

  async save(checkpoint: WatchdogCheckpoint): Promise<void> {
    if (!isWatchdogCheckpoint(checkpoint)) {
      throw new Error("Invalid watchdog checkpoint");
    }

    const tempPath = `${this.checkpointPath}.tmp`;
    try {
      const dir = path.dirname(this.checkpointPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tempPath, JSON.stringify(checkpoint, null, 2));
      await fs.rename(tempPath, this.checkpointPath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      console.error("Failed to save checkpoint:", error);
      throw error;
    }
  }

  async load(): Promise<WatchdogCheckpoint | null> {
    try {
      const content = await fs.readFile(this.checkpointPath, "utf-8");
      const checkpoint: unknown = JSON.parse(content);
      return isWatchdogCheckpoint(checkpoint) ? checkpoint : null;
    } catch {
      // File doesn't exist or is corrupt - return null for fresh start
      return null;
    }
  }

  async delete(): Promise<void> {
    try {
      await fs.unlink(this.checkpointPath);
    } catch {
      // File doesn't exist - no action needed
    }
  }
}
