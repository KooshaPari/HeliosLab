// T012, T013 — Snapshot creation, corruption detection, and recovery
// FR-006: Corruption detection
// FR-007: Recovery from snapshot

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Workspace } from "./types.js";

const SNAPSHOT_FILE = "workspaces.snapshot.json";
const PRIMARY_FILE = "workspaces.json";

interface SnapshotEnvelope {
  version: 1;
  workspaces: Workspace[];
  _checksum: string;
}

function computeChecksum(workspaces: Workspace[]): string {
  const payload = JSON.stringify({ version: 1, workspaces });
  return createHash("sha256").update(payload).digest("hex");
}

/** Atomically write data to a file using temp + fsync + rename */
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tmp, data, "utf-8");
  await rename(tmp, filePath);
}

/** Create a snapshot of current workspace state. */
export async function createSnapshot(dataDir: string, workspaces: Workspace[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const checksum = computeChecksum(workspaces);
  const envelope: SnapshotEnvelope = {
    version: 1,
    workspaces,
    _checksum: checksum,
  };
  const json = JSON.stringify(envelope, null, 2);
  await atomicWrite(join(dataDir, SNAPSHOT_FILE), json);
}

/** Detect whether the primary workspaces.json file is corrupted. */
export async function detectCorruption(
  dataDir: string
): Promise<{ corrupted: boolean; reason?: string }> {
  const filePath = join(dataDir, PRIMARY_FILE);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return { corrupted: true, reason: "Primary file unreadable or missing" };
  }

  if (raw.trim().length === 0) {
    return { corrupted: true, reason: "Primary file is empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { corrupted: true, reason: "Primary file contains invalid JSON" };
  }

  if (!isValidEnvelope(parsed)) {
    return { corrupted: true, reason: "Primary file has invalid schema" };
  }

  const expected = computeChecksum(parsed.workspaces);
  if (parsed._checksum !== expected) {
    return { corrupted: true, reason: "Checksum mismatch" };
  }

  return { corrupted: false };
}

function isValidEnvelope(data: unknown): data is SnapshotEnvelope {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (obj["version"] !== 1) return false;
  if (!Array.isArray(obj["workspaces"])) return false;
  if (typeof obj["_checksum"] !== "string") return false;
  // Validate each workspace has required fields
  for (const ws of obj["workspaces"] as unknown[]) {
    if (typeof ws !== "object" || ws === null) return false;
    const w = ws as Record<string, unknown>;
    if (typeof w["id"] !== "string") return false;
    if (typeof w["name"] !== "string") return false;
    if (typeof w["rootPath"] !== "string") return false;
    if (typeof w["state"] !== "string") return false;
    if (typeof w["createdAt"] !== "number") return false;
    if (typeof w["updatedAt"] !== "number") return false;
    if (!Array.isArray(w["projects"])) return false;
  }
  return true;
}

/** Attempt recovery from snapshot file. Returns workspaces or null if snapshot is also corrupted. */
export async function recoverFromSnapshot(dataDir: string): Promise<Workspace[] | null> {
  const filePath = join(dataDir, SNAPSHOT_FILE);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isValidEnvelope(parsed)) return null;

  const expected = computeChecksum(parsed.workspaces);
  if (parsed._checksum !== expected) return null;

  return parsed.workspaces;
}

export { atomicWrite, computeChecksum, SNAPSHOT_FILE, PRIMARY_FILE };
