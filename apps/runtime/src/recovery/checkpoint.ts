import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

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

interface CheckpointCandidate {
  checksum?: unknown;
  sessions?: unknown;
  timestamp?: unknown;
  version?: unknown;
}

interface SessionCandidate {
  [key: string]: unknown;
  environmentVariables?: unknown;
  scrollbackSnapshot?: unknown;
  sessionId?: unknown;
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
      const fd = await fs.open(tempPath, "r+");
      await fd.sync();
      await fd.close();

      // Atomic rename
      await fs.rename(tempPath, checkpointPath);
    } catch (err) {
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
      const checkpoint: unknown = JSON.parse(data);

      // Validate checksum
      if (!this.isValidCheckpoint(checkpoint)) {
        console.warn("Checkpoint integrity or schema validation failed - trying backup");
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
      const checkpoint: unknown = JSON.parse(data);

      if (!this.isValidCheckpoint(checkpoint)) {
        console.warn("Backup checkpoint integrity or schema validation failed - total loss");
        return null;
      }

      return checkpoint;
    } catch {
      // Backup doesn't exist or is corrupted
      return null;
    }
  }

  private isValidCheckpoint(checkpoint: unknown): checkpoint is Checkpoint {
    return this.verifyChecksum(checkpoint) && validateCheckpoint(checkpoint).valid;
  }

  private verifyChecksum(checkpoint: unknown): checkpoint is Checkpoint {
    if (!isCheckpointCandidate(checkpoint) || typeof checkpoint.checksum !== "string") {
      return false;
    }

    const serialized = JSON.stringify(checkpoint.sessions);
    const calculated = createHash("sha256").update(serialized).digest("hex");
    return calculated === checkpoint.checksum;
  }

  private getCheckpointPath(): string {
    return path.join(this.checkpointDataDir, "recovery", "checkpoint.json");
  }
}

export function validateCheckpoint(checkpoint: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isCheckpointCandidate(checkpoint)) {
    return {
      valid: false,
      errors: [{ field: "checkpoint", reason: "Expected an object" }],
    };
  }

  // Verify version
  const version = checkpoint.version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    errors.push({
      field: "version",
      reason: "Expected a positive integer schema version",
    });
  } else if ((version as number) > CHECKPOINT_VERSION) {
    errors.push({
      field: "version",
      reason: `Unsupported schema version: ${version}. Supported: ${CHECKPOINT_VERSION}`,
    });
  }

  // Verify timestamp
  const now = Date.now();
  const timestamp = checkpoint.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    errors.push({
      field: "timestamp",
      reason: "Expected a finite numeric timestamp",
    });
  } else if (timestamp > now + CLOCK_SKEW_TOLERANCE_MS) {
    errors.push({
      field: "timestamp",
      reason: `Timestamp in future (${new Date(timestamp).toISOString()})`,
    });
  }

  if (
    typeof timestamp === "number" &&
    Number.isFinite(timestamp) &&
    now - timestamp > MAX_CHECKPOINT_AGE_MS
  ) {
    errors.push({
      field: "timestamp",
      reason: `Checkpoint too old (${new Date(timestamp).toISOString()})`,
    });
  }

  // Validate sessions
  const sessions = checkpoint.sessions;
  if (!Array.isArray(sessions)) {
    errors.push({ field: "sessions", reason: "Expected an array" });
  } else {
    for (const session of sessions) {
      const sessionErrors = validateSession(session);
      errors.push(...sessionErrors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateSession(session: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isSessionCandidate(session)) {
    return [{ field: "session", reason: "Expected an object" }];
  }

  const sessionId = typeof session.sessionId === "string" ? session.sessionId : undefined;

  if (!sessionId) {
    errors.push(validationError(sessionId, "sessionId", "Expected a non-empty string"));
  }

  for (const field of [
    "terminalId",
    "laneId",
    "workingDirectory",
    "zelijjSessionName",
    "shellCommand",
  ] as const) {
    if (typeof session[field] !== "string" || session[field].length === 0) {
      errors.push(validationError(sessionId, field, "Expected a non-empty string"));
    }
  }

  const scrollbackSnapshot = session.scrollbackSnapshot;
  if (typeof scrollbackSnapshot !== "string") {
    errors.push(validationError(sessionId, "scrollbackSnapshot", "Expected a string"));
  } else if (Buffer.byteLength(scrollbackSnapshot, "utf8") > MAX_SCROLLBACK_SIZE) {
    errors.push(
      validationError(sessionId, "scrollbackSnapshot", `Exceeds ${MAX_SCROLLBACK_SIZE} byte limit`)
    );
  }

  const environmentVariables = session.environmentVariables;
  if (
    !isRecord(environmentVariables) ||
    Object.values(environmentVariables).some(value => typeof value !== "string")
  ) {
    errors.push(
      validationError(sessionId, "environmentVariables", "Expected a string-valued object")
    );
  }

  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCheckpointCandidate(value: unknown): value is CheckpointCandidate {
  return isRecord(value);
}

function isSessionCandidate(value: unknown): value is SessionCandidate {
  return isRecord(value);
}

function validationError(
  sessionId: string | undefined,
  field: string,
  reason: string
): ValidationError {
  return sessionId === undefined ? { field, reason } : { sessionId, field, reason };
}

export function estimateCheckpointSize(sessionCount: number): number {
  // Rough estimate:
  // - Per session: ~500 bytes overhead + MAX_SCROLLBACK_SIZE
  // - Plus ~1KB for metadata
  const perSession = 500 + MAX_SCROLLBACK_SIZE;
  return 1024 + sessionCount * perSession;
}
