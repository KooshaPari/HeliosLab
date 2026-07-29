import { promises as fs } from "fs";
import path from "path";
import { RecoveryStage, type RecoveryState } from "./state-machine-types.js";

const RECOVERY_STAGES = new Set<string>(Object.values(RecoveryStage));

export function isRecoveryState(value: unknown): value is RecoveryState {
  if (typeof value !== "object" || value === null) return false;

  const state = value as Partial<RecoveryState>;
  return (
    typeof state.stage === "string" &&
    RECOVERY_STAGES.has(state.stage) &&
    typeof state.timestamp === "number" &&
    Number.isFinite(state.timestamp) &&
    typeof state.attemptCount === "number" &&
    Number.isInteger(state.attemptCount) &&
    state.attemptCount >= 0 &&
    (state.lastError === undefined || typeof state.lastError === "string")
  );
}

export function getRecoveryStatePath(recoveryDataDir: string): string {
  return path.join(recoveryDataDir, "recovery", "recovery-state.json");
}

export async function loadRecoveryState(recoveryDataDir: string): Promise<RecoveryState | null> {
  try {
    const statePath = getRecoveryStatePath(recoveryDataDir);
    const data = await fs.readFile(statePath, "utf-8");
    const parsed: unknown = JSON.parse(data);
    return isRecoveryState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function persistRecoveryState(
  recoveryDataDir: string,
  state: RecoveryState
): Promise<void> {
  try {
    const statePath = getRecoveryStatePath(recoveryDataDir);
    const recoveryDir = path.dirname(statePath);
    await fs.mkdir(recoveryDir, { recursive: true });

    const tempPath = `${statePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2));
    await fs.rename(tempPath, statePath);
  } catch (err) {
    console.error("Failed to persist recovery state:", err);
  }
}

export async function deleteRecoveryState(recoveryDataDir: string): Promise<void> {
  try {
    await fs.unlink(getRecoveryStatePath(recoveryDataDir));
  } catch {
    // File doesn't exist - ok
  }
}
