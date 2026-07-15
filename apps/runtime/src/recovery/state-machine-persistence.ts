import { promises as fs } from "fs";
import path from "path";
import type { RecoveryState } from "./state-machine-types.js";

export function getRecoveryStatePath(recoveryDataDir: string): string {
  return path.join(recoveryDataDir, "recovery", "recovery-state.json");
}

export async function loadRecoveryState(recoveryDataDir: string): Promise<RecoveryState | null> {
  try {
    const statePath = getRecoveryStatePath(recoveryDataDir);
    const data = await fs.readFile(statePath, "utf-8");
    return JSON.parse(data) as RecoveryState;
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
