// T002 - In-memory lane registry with secondary indexes

import type { LaneState } from "./state_machine.js";

export interface LaneRecord {
  laneId: string;
  workspaceId: string;
  state: LaneState;
  worktreePath: string | null;
  parTaskPid: number | null;
  attachedAgents: string[];
  baseBranch: string;
  createdAt: string;
  updatedAt: string;
}

export class DuplicateLaneError extends Error {
  constructor(laneId: string) {
    super(`Lane already exists: ${laneId}`);
    this.name = "DuplicateLaneError";
  }
}

export class LaneNotFoundError extends Error {
  constructor(laneId: string) {
    super(`Lane not found: ${laneId}`);
    this.name = "LaneNotFoundError";
  }
}

export class LaneCapacityExceededError extends Error {
  constructor(limit: number) {
    super(`Lane capacity exceeded: maximum ${limit} lanes allowed`);
    this.name = "LaneCapacityExceededError";
  }
}

export class LaneRegistry {
  private readonly lanes = new Map<string, LaneRecord>();
  private readonly workspaceIndex = new Map<string, Set<string>>();
  private readonly capacityLimit: number;

  constructor(capacityLimit: number = 50) {
    this.capacityLimit = capacityLimit;
  }

  register(record: LaneRecord): void {
    if (this.lanes.has(record.laneId)) {
      throw new DuplicateLaneError(record.laneId);
    }
    // Only count non-closed lanes toward capacity
    const activeCount = this.getActive().length;
    if (activeCount >= this.capacityLimit) {
      throw new LaneCapacityExceededError(this.capacityLimit);
    }
    this.lanes.set(record.laneId, { ...record });
    this.addToWorkspaceIndex(record.workspaceId, record.laneId);
  }

  get(laneId: string): LaneRecord | undefined {
    const _record = this.lanes.get(laneId);
    return _record ? { ..._record } : undefined;
  }

  getByWorkspace(workspaceId: string): LaneRecord[] {
    const laneIds = this.workspaceIndex.get(workspaceId);
    if (!laneIds) return [];
    return [...laneIds]
      .map(id => this.lanes.get(id))
      .filter((r): r is LaneRecord => r !== undefined)
      .map(r => ({ ...r }));
  }

  update(laneId: string, patch: Partial<LaneRecord>): void {
    const existing = this.lanes.get(laneId);
    if (!existing) {
      throw new LaneNotFoundError(laneId);
    }
    const updated: LaneRecord = {
      ...existing,
      ...patch,
      laneId: existing.laneId,
      updatedAt: new Date().toISOString(),
    };
    // If workspaceId changed, update index
    if (patch.workspaceId !== undefined && patch.workspaceId !== existing.workspaceId) {
      this.removeFromWorkspaceIndex(existing.workspaceId, laneId);
      this.addToWorkspaceIndex(patch.workspaceId, laneId);
    }
    this.lanes.set(laneId, updated);
  }

  remove(laneId: string): void {
    const existing = this.lanes.get(laneId);
    if (!existing) {
      // No-op for non-existent lane (per spec)
      return;
    }
    this.removeFromWorkspaceIndex(existing.workspaceId, laneId);
    this.lanes.delete(laneId);
  }

  list(): LaneRecord[] {
    return [...this.lanes.values()].map(r => ({ ...r }));
  }

  count(): number {
    return this.lanes.size;
  }

  getActive(): LaneRecord[] {
    return [...this.lanes.values()].filter(r => r.state !== "closed").map(r => ({ ...r }));
  }

  clear(): void {
    this.lanes.clear();
    this.workspaceIndex.clear();
  }

  private addToWorkspaceIndex(workspaceId: string, laneId: string): void {
    let set = this.workspaceIndex.get(workspaceId);
    if (!set) {
      set = new Set();
      this.workspaceIndex.set(workspaceId, set);
    }
    set.add(laneId);
  }

  private removeFromWorkspaceIndex(workspaceId: string, laneId: string): void {
    const set = this.workspaceIndex.get(workspaceId);
    if (set) {
      set.delete(laneId);
      if (set.size === 0) {
        this.workspaceIndex.delete(workspaceId);
      }
    }
  }
}
