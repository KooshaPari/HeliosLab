import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";

export const CHECKPOINT_VERSION = 1;
export const MAX_SCROLLBACK_SIZE = 10240; // 10 KB per session
export const MAX_TOTAL_CHECKPOINT_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_CHECKPOINT_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

export interface CheckpointSession {
  sessionId: string;
  terminalId: string;
  laneId: string;
  workingDirectory: string;
  environmentVariables: Record<string, string>;
  scrollbackSnapshot: string;
  zelijjSessionName: string;
  shellCommand: string;
}

export interface Checkpoint {
  version: number;
  timestamp: number;
  checksum: string;
  sessions: CheckpointSession[];
}

export interface ValidationError {
  sessionId?: string;
  field: string;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export class CheckpointWriter {
  private checkpointDataDir: string;

  constructor(checkpointDataDir: string) {
    this.checkpointDataDir = checkpointDataDir;
  }

  async write(checkpoint: Checkpoint): Promise<void> {
    const checkpointPath = this.getCheckpointPath();

    try {
      // Backup previous checkpoint
      await this.backupPreviousCheckpoint(checkpointPath);

      // Clean stale temp files
      await this.cleanStaleTempFiles(checkpointPath);

      // Serialize and calculate checksum
      const serialized = JSON.stringify(checkpoint.sessions);
      const checksum = this.calculateChecksum(serialized);

      const checkpointWithChecksum: Checkpoint = {
        ...checkpoint,
        checksum,
      };

      // Write to temp file
      const tempPath = `${checkpointPath}.tmp`;
      const content = JSON.stringify(checkpointWithChecksum, null, 2);

      await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
      await fs.writeFile(tempPath, content);

      // Fsync
      const fd = await fs.open(tempPath, "r");
      await fd.sync();
      await fd.close();

      // Atomic rename
      await fs.rename(tempPath, checkpointPath);
    } catch {
      console.error("Failed to write checkpoint:", err);
      throw err;
    }
  }

  private async backupPreviousCheckpoint(checkpointPath: string): Promise<void> {
    const backupPath = `${checkpointPath}.backup`;
    try {
      await fs.rename(checkpointPath, backupPath);
    } catch {
      // Previous checkpoint doesn't exist or rename failed
    }
  }

  private async cleanStaleTempFiles(checkpointPath: string): Promise<void> {
    const tempPath = `${checkpointPath}.tmp`;
    try {
      await fs.unlink(tempPath);
    } catch {
      // Temp file doesn't exist
    }
  }

  private calculateChecksum(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  getCheckpointPath(): string {
    return path.join(this.checkpointDataDir, "recovery", "checkpoint.json");
  }
}

export class CheckpointReader {
  private checkpointDataDir: string;

  constructor(checkpointDataDir: string) {
    this.checkpointDataDir = checkpointDataDir;
  }

  async read(): Promise<Checkpoint | null> {
    const checkpointPath = this.getCheckpointPath();

    try {
      const data = await fs.readFile(checkpointPath, "utf-8");
      const _checkpoint = JSON.parse(data) as Checkpoint;

      // Validate checksum
      if (!this.verifyChecksum(checkpoint)) {
        console.warn("Checkpoint checksum mismatch - trying backup");
        return await this.readBackup();
      }

      return checkpoint;
    } catch {
      // Primary checkpoint doesn't exist or is corrupted - try backup
      return await this.readBackup();
    }
  }

  private async readBackup(): Promise<Checkpoint | null> {
    const backupPath = `${this.getCheckpointPath()}.backup`;
    try {
      const data = await fs.readFile(backupPath, "utf-8");
      const _checkpoint = JSON.parse(data) as Checkpoint;

      if (!this.verifyChecksum(checkpoint)) {
        console.warn("Backup checkpoint checksum mismatch - total loss");
        return null;
      }

      return checkpoint;
    } catch {
      // Backup doesn't exist or is corrupted
      return null;
    }
  }

  private verifyChecksum(checkpoint: Checkpoint): boolean {
    const serialized = JSON.stringify(checkpoint.sessions);
    const calculated = createHash("sha256").update(serialized).digest("hex");
    return calculated === checkpoint.checksum;
  }

  private getCheckpointPath(): string {
    return path.join(this.checkpointDataDir, "recovery", "checkpoint.json");
  }
}

export function validateCheckpoint(checkpoint: Checkpoint): ValidationResult {
  const errors: ValidationError[] = [];

  // Verify version
  if (checkpoint.version > CHECKPOINT_VERSION) {
    errors.push({
      field: "version",
      reason: `Unsupported schema version: ${checkpoint.version}. Supported: ${CHECKPOINT_VERSION}`,
    });
  }

  // Verify timestamp
  const now = Date.now();
  if (checkpoint.timestamp > now + CLOCK_SKEW_TOLERANCE_MS) {
    errors.push({
      field: "timestamp",
      reason: `Timestamp in future (${new Date(checkpoint.timestamp).toISOString()})`,
    });
  }

  if (now - checkpoint.timestamp > MAX_CHECKPOINT_AGE_MS) {
    errors.push({
      field: "timestamp",
      reason: `Checkpoint too old (${new Date(checkpoint.timestamp).toISOString()})`,
    });
  }

  // Validate sessions
  for (const session of checkpoint.sessions) {
    const sessionErrors = validateSession(session);
    errors.push(...sessionErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateSession(session: CheckpointSession): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!session.sessionId) {
    errors.push({
      sessionId: session.sessionId,
      field: "sessionId",
      reason: "Required field missing",
    });
  }

  if (!session.terminalId) {
    errors.push({
      sessionId: session.sessionId,
      field: "terminalId",
      reason: "Required field missing",
    });
  }

  if (!session.laneId) {
    errors.push({
      sessionId: session.sessionId,
      field: "laneId",
      reason: "Required field missing",
    });
  }

  if (!session.workingDirectory) {
    errors.push({
      sessionId: session.sessionId,
      field: "workingDirectory",
      reason: "Required field missing",
    });
  }

  return errors;
}

export function estimateCheckpointSize(sessionCount: number): number {
  // Rough estimate:
  // - Per session: ~500 bytes overhead + MAX_SCROLLBACK_SIZE
  // - Plus ~1KB for metadata
  const perSession = 500 + MAX_SCROLLBACK_SIZE;
  return 1024 + sessionCount * perSession;
}
