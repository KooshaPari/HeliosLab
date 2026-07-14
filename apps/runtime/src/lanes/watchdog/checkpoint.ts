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

export class CheckpointManager {
  private readonly checkpointPath: string;

  constructor(baseDir?: string) {
    const heliosDataDir = baseDir ?? path.join(os.homedir(), ".helios", "data");
    this.checkpointPath = path.join(heliosDataDir, "watchdog_checkpoint.json");
  }

  async save(checkpoint: WatchdogCheckpoint): Promise<void> {
    try {
      const dir = path.dirname(this.checkpointPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.checkpointPath, JSON.stringify(checkpoint, null, 2));
    } catch {
      console.error("Failed to save checkpoint:", error);
      throw error;
    }
  }

  async load(): Promise<WatchdogCheckpoint | null> {
    try {
      const content = await fs.readFile(this.checkpointPath, "utf-8");
      const _checkpoint = JSON.parse(content) as WatchdogCheckpoint;
      return checkpoint;
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
