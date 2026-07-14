// T003 — In-memory workspace store
// T011 — JSON file persistence backend
// T014 — Concurrent operation serialization

import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Workspace, WorkspaceStore } from "./types.js";
import {
  atomicWrite,
  computeChecksum,
  createSnapshot,
  detectCorruption,
  recoverFromSnapshot,
  PRIMARY_FILE,
} from "./snapshot.js";

export class InMemoryWorkspaceStore implements WorkspaceStore {
  private readonly data = new Map<string, Workspace>();

  async getAll(): Promise<Workspace[]> {
    return [...this.data.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async getById(id: string): Promise<Workspace | undefined> {
    return this.data.get(id);
  }

  async getByName(name: string): Promise<Workspace | undefined> {
    const lower = name.toLowerCase();
    for (const ws of this.data.values()) {
      if (ws.name.toLowerCase() === lower) {
        return ws;
      }
    }
    return undefined;
  }

  async save(workspace: Workspace): Promise<void> {
    this.data.set(workspace.id, workspace);
  }

  async remove(id: string): Promise<void> {
    this.data.delete(id);
  }

  async flush(): Promise<void> {
    // No-op for in-memory backend
  }
}

export function createInMemoryStore(): WorkspaceStore {
  return new InMemoryWorkspaceStore();
}

// ── Promise-based mutex (T014) ──────────────────────────────────────────

const LOCK_TIMEOUT_MS = 5000;

class Mutex {
  private queue: Array<{
    resolve: (release: () => void) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(e => e.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error("Write lock timeout: could not acquire lock within 5 seconds"));
      }, LOCK_TIMEOUT_MS);

      const entry = { resolve, timer };

      if (!this.locked) {
        this.locked = true;
        clearTimeout(timer);
        resolve(this.createRelease());
      } else {
        this.queue.push(entry);
      }
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(this.createRelease());
      } else {
        this.locked = false;
      }
    };
  }
}

// ── JSON file persistence (T011, T013) ──────────────────────────────────

export class JsonWorkspaceStore implements WorkspaceStore {
  private readonly data = new Map<string, Workspace>();
  private readonly dataDir: string;
  private readonly mutex = new Mutex();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  // FR-005: Persist across restart
  async load(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const filePath = join(this.dataDir, PRIMARY_FILE);

    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch {
      // Fresh install — no file exists
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Parse failed — attempt recovery
      await this.attemptRecovery();
      return;
    }

    // Validate envelope
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>)["workspaces"])
    ) {
      await this.attemptRecovery();
      return;
    }

    const envelope = parsed as { workspaces: Workspace[]; _checksum?: string };

    // Verify checksum if present
    if (typeof envelope._checksum === "string") {
      const expected = computeChecksum(envelope.workspaces);
      if (envelope._checksum !== expected) {
        console.warn("[workspace-store] Checksum mismatch in primary file, attempting recovery");
        await this.attemptRecovery();
        return;
      }
    }

    for (const ws of envelope.workspaces) {
      this.data.set(ws.id, ws);
    }
  }

  private async attemptRecovery(): Promise<void> {
    const corruption = await detectCorruption(this.dataDir);
    if (corruption.corrupted) {
      console.warn(`[workspace-store] Primary file corrupted: ${corruption.reason}`);
    }

    const recovered = await recoverFromSnapshot(this.dataDir);
    if (recovered !== null) {
      console.warn("[workspace-store] Recovered from snapshot");
      for (const ws of recovered) {
        this.data.set(ws.id, ws);
      }
      // Immediately flush to fix primary file
      await this.flushInternal();
    } else {
      console.error(
        "[workspace-store] Recovery failed — both primary and snapshot corrupted. Starting empty."
      );
    }
  }

  async getAll(): Promise<Workspace[]> {
    return [...this.data.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async getById(id: string): Promise<Workspace | undefined> {
    return this.data.get(id);
  }

  async getByName(name: string): Promise<Workspace | undefined> {
    const lower = name.toLowerCase();
    for (const ws of this.data.values()) {
      if (ws.name.toLowerCase() === lower) {
        return ws;
      }
    }
    return undefined;
  }

  async save(workspace: Workspace): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.data.set(workspace.id, workspace);
      await this.flushInternal();
    } finally {
      release();
    }
  }

  async remove(id: string): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.data.delete(id);
      await this.flushInternal();
    } finally {
      release();
    }
  }

  async flush(): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      await this.flushInternal();
    } finally {
      release();
    }
  }

  /** Internal flush — caller must hold mutex (or be in load/recovery path). */
  private async flushInternal(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const workspaces = [...this.data.values()];
    const checksum = computeChecksum(workspaces);
    const envelope = { version: 1, workspaces, _checksum: checksum };
    const json = JSON.stringify(envelope, null, 2);
    await atomicWrite(join(this.dataDir, PRIMARY_FILE), json);
    // T012: Create snapshot after every successful flush
    await createSnapshot(this.dataDir, workspaces);
  }
}

/** Factory: creates a JsonWorkspaceStore and loads existing data. */
// FR-005
export async function createJsonStore(dataDir: string): Promise<WorkspaceStore> {
  const store = new JsonWorkspaceStore(dataDir);
  await store.load();
  return store;
}
