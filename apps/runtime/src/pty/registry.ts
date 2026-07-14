/**
 * In-memory PTY process registry with secondary indexes for lane and session lookups.
 *
 * @module
 */

import type { PtyState } from "./state_machine.js";

/** Dimensions of a PTY viewport. */
export interface PtyDimensions {
  readonly cols: number;
  readonly rows: number;
}

/** A single PTY record in the registry. */
export interface PtyRecord {
  readonly ptyId: string;
  readonly laneId: string;
  readonly sessionId: string;
  readonly terminalId: string;
  readonly pid: number;
  state: PtyState;
  dimensions: PtyDimensions;
  readonly createdAt: number;
  updatedAt: number;
  readonly env: Readonly<Record<string, string>>;
}

/** Error thrown when a duplicate PTY ID is registered. */
export class DuplicatePtyError extends Error {
  constructor(ptyId: string) {
    super(`PTY '${ptyId}' is already registered`);
    this.name = "DuplicatePtyError";
  }
}

/** Error thrown when the registry capacity is exceeded. */
export class RegistryCapacityError extends Error {
  constructor(capacity: number) {
    super(`PTY registry capacity exceeded (max ${capacity})`);
    this.name = "RegistryCapacityError";
  }
}

/** Summary of an orphan reconciliation run. */
export interface ReconciliationSummary {
  readonly found: number;
  readonly reattached: number;
  readonly terminated: number;
  readonly errors: number;
  readonly durationMs: number;
}

/**
 * In-memory registry of PTY records with O(1) lookups by PTY ID
 * and secondary indexes for lane and session.
 */
export class PtyRegistry {
  private readonly primary = new Map<string, PtyRecord>();
  private readonly byLane = new Map<string, Set<string>>();
  private readonly bySession = new Map<string, Set<string>>();
  private readonly maxCapacity: number;

  /**
   * @param maxCapacity - Maximum number of PTY records (default 300 per NFR-007-003).
   */
  constructor(maxCapacity = 300) {
    this.maxCapacity = maxCapacity;
  }

  /**
   * Register a new PTY record.
   *
   * @param record - The PTY record to register.
   * @throws {@link DuplicatePtyError} if the ptyId is already registered.
   * @throws {@link RegistryCapacityError} if the registry is full.
   */
  register(record: PtyRecord): void {
    if (this.primary.has(record.ptyId)) {
      throw new DuplicatePtyError(record.ptyId);
    }
    if (this.primary.size >= this.maxCapacity) {
      throw new RegistryCapacityError(this.maxCapacity);
    }

    this.primary.set(record.ptyId, record);
    this.addToIndex(this.byLane, record.laneId, record.ptyId);
    this.addToIndex(this.bySession, record.sessionId, record.ptyId);
  }

  /**
   * Look up a PTY record by ID.
   *
   * @param ptyId - The PTY ID.
   * @returns The record, or `undefined` if not found.
   */
  get(ptyId: string): PtyRecord | undefined {
    return this.primary.get(ptyId);
  }

  /**
   * Get all PTY records for a given lane.
   *
   * @param laneId - The lane ID.
   * @returns An array of matching records.
   */
  getByLane(laneId: string): PtyRecord[] {
    return this.resolveIndex(this.byLane, laneId);
  }

  /**
   * Get all PTY records for a given session.
   *
   * @param sessionId - The session ID.
   * @returns An array of matching records.
   */
  getBySession(sessionId: string): PtyRecord[] {
    return this.resolveIndex(this.bySession, sessionId);
  }

  /**
   * Partially update a PTY record. Automatically bumps `updatedAt`.
   *
   * @param ptyId - The PTY ID.
   * @param patch - Fields to update.
   */
  update(ptyId: string, patch: Partial<PtyRecord>): void {
    const existing = this.primary.get(ptyId);
    if (!existing) {
      return;
    }

    // If laneId or sessionId changed, update secondary indexes.
    if (patch.laneId !== undefined && patch.laneId !== existing.laneId) {
      this.removeFromIndex(this.byLane, existing.laneId, ptyId);
      this.addToIndex(this.byLane, patch.laneId, ptyId);
    }
    if (patch.sessionId !== undefined && patch.sessionId !== existing.sessionId) {
      this.removeFromIndex(this.bySession, existing.sessionId, ptyId);
      this.addToIndex(this.bySession, patch.sessionId, ptyId);
    }

    Object.assign(existing, patch, { updatedAt: Date.now() });
  }

  /**
   * Remove a PTY record from the registry and all indexes.
   *
   * @param ptyId - The PTY ID.
   */
  remove(ptyId: string): void {
    const _record = this.primary.get(ptyId);
    if (!_record) {
      return;
    }

    this.removeFromIndex(this.byLane, _record.laneId, ptyId);
    this.removeFromIndex(this.bySession, _record.sessionId, ptyId);
    this.primary.delete(ptyId);
  }

  /**
   * List all PTY records.
   *
   * @returns A snapshot array of all records.
   */
  list(): PtyRecord[] {
    return Array.from(this.primary.values());
  }

  /**
   * Total count of registered PTYs.
   */
  count(): number {
    return this.primary.size;
  }

  /**
   * Detect and reconcile orphaned PTY processes on startup.
   *
   * Scans running processes for children matching the shell pattern,
   * compares against the registry, and terminates unrecoverable orphans.
   *
   * @param shellPatterns - Shell binary names to search for (default: common shells).
   * @param gracePeriodMs - Time to wait after SIGTERM before SIGKILL (default 5000).
   * @returns A reconciliation summary.
   */
  async reconcileOrphans(
    shellPatterns: string[] = ["bash", "zsh", "sh", "fish"],
    gracePeriodMs = 5000
  ): Promise<ReconciliationSummary> {
    const start = performance.now();
    let found = 0;
    let reattached = 0;
    let terminated = 0;
    let errors = 0;

    try {
      const orphanPids = await this.scanForOrphans(shellPatterns);
      found = orphanPids.length;

      for (const pid of orphanPids) {
        try {
          // Check if any existing record already has this PID
          const existingRecord = this.list().find(r => r.pid === pid);
          if (existingRecord) {
            // Already tracked, not actually orphaned
            reattached++;
            continue;
          }

          // Cannot reattach — terminate it
          await this.terminateOrphan(pid, gracePeriodMs);
          terminated++;
        } catch {
          errors++;
        }
      }
    } catch {
      // Permission errors or platform issues scanning the process table
      errors++;
    }

    return {
      found,
      reattached,
      terminated,
      errors,
      durationMs: performance.now() - start,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private addToIndex(index: Map<string, Set<string>>, key: string, ptyId: string): void {
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(ptyId);
  }

  private removeFromIndex(index: Map<string, Set<string>>, key: string, ptyId: string): void {
    const set = index.get(key);
    if (set) {
      set.delete(ptyId);
      if (set.size === 0) {
        index.delete(key);
      }
    }
  }

  private resolveIndex(index: Map<string, Set<string>>, key: string): PtyRecord[] {
    const ids = index.get(key);
    if (!ids) return [];
    const records: PtyRecord[] = [];
    for (const id of ids) {
      const rec = this.primary.get(id);
      if (rec) records.push(rec);
    }
    return records;
  }

  /**
   * Scan the process table for shell processes that are not in the registry.
   * Uses platform-appropriate commands (ps on macOS/Linux).
   */
  private async scanForOrphans(shellPatterns: string[]): Promise<number[]> {
    const currentPid = process.pid;
    try {
      const proc = Bun.spawn(["ps", "-eo", "pid,ppid,comm"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      await proc.exited;

      const orphanPids: number[] = [];
      const lines = output.trim().split("\n").slice(1); // skip header

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;

        const pid = parseInt(parts[0]!, 10);
        const ppid = parseInt(parts[1]!, 10);
        const comm = parts.slice(2).join(" ");

        if (isNaN(pid) || isNaN(ppid)) continue;

        // Only consider processes whose parent is this runtime
        // or whose parent has exited (ppid=1 on Linux, launchd on macOS)
        if (ppid !== currentPid && ppid !== 1) continue;

        const basename = comm.split("/").pop() ?? "";
        const isShell = shellPatterns.some(
          pattern => basename === pattern || basename === `-${pattern}`
        );

        if (isShell) {
          // Check if this PID is already in our registry
          const tracked = this.list().some(r => r.pid === pid);
          if (!tracked) {
            orphanPids.push(pid);
          }
        }
      }

      return orphanPids;
    } catch {
      return [];
    }
  }

  /**
   * Terminate an orphaned process: SIGTERM first, then SIGKILL after grace period.
   */
  private async terminateOrphan(pid: number, gracePeriodMs: number): Promise<void> {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited
      return;
    }

    // Wait for grace period, then check if still alive
    await new Promise(resolve => setTimeout(resolve, gracePeriodMs));

    try {
      // Signal 0 checks existence without sending a signal
      process.kill(pid, 0);
      // Still alive — escalate to SIGKILL
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited after SIGTERM — good
    }
  }
}
