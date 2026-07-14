// T003 - Lane lifecycle commands + T004 - Event publishing to local bus
// T006-T010 - Worktree provisioning, cleanup, PTY termination, orphan reconciliation
// T011-T015 - Par task binding, termination, execution, stale detection, lifecycle events

import * as path from "node:path";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import { LaneRegistry, type LaneRecord, LaneNotFoundError } from "./registry.js";
import {
  transition,
  withLaneLock,
  recordTransition,
  type LaneState,
  type LaneEvent,
} from "./state_machine.js";
import {
  shareLane,
  attachAgent,
  detachAgent,
  LaneClosedError,
  SharedLaneCleanupError,
} from "./sharing.js";
import {
  provisionWorktree,
  removeWorktree,
  reconcileOrphanedWorktrees,
  WorktreeProvisionError,
  type ReconciliationResult,
} from "./worktree.js";

// ── T016: Full Reconciliation Result ─────────────────────────────────────────

export interface FullReconciliationResult {
  orphanedWorktrees: number;
  orphanedRecords: number;
  orphanedParTasks: number;
  orphanedPtys: number;
  totalCleaned: number;
  cleaned: number;
  timedOut: boolean;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class NotImplementedError extends Error {
  constructor(operation: string) {
    super(`Not implemented: ${operation} (placeholder for future WP)`);
    this.name = "NotImplementedError";
  }
}

// ── PTY Manager Interface (T008) ────────────────────────────────────────────

export interface PtyHandle {
  ptyId: string;
  laneId: string;
}

export interface PtyManager {
  getByLane(laneId: string): PtyHandle[];
  terminate(ptyId: string): Promise<void>;
}

// ── Event Types ──────────────────────────────────────────────────────────────

// T015: Comprehensive lane lifecycle event catalog
export type LaneBusEventTopic =
  // Core lane lifecycle
  | "lane.create.started"
  | "lane.created"
  | "lane.state.changed"
  | "lane.shared"
  | "lane.cleaning"
  | "lane.closed"
  | "lane.ptys_terminated"
  | "lane.provision_failed"
  | "lane.worktree.provisioned"
  | "lane.worktree.removed"
  | "reconciliation.completed";

// ── ID Generation ────────────────────────────────────────────────────────────

let laneIdCounter = 0;

function generateLaneId(): string {
  laneIdCounter += 1;
  return `lane_${Date.now()}_${laneIdCounter.toString(36)}`;
}

/** Reset counter for testing. */
export function _resetIdCounter(): void {
  laneIdCounter = 0;
}

// ── Lane Manager ─────────────────────────────────────────────────────────────

export interface LaneManagerOptions {
  bus?: LocalBus | null;
  capacityLimit?: number;
  ptyManager?: PtyManager | null;
  ptyTerminationTimeoutMs?: number;
}

export class LaneManager {
  private readonly registry: LaneRegistry;
  private readonly bus: LocalBus | null;
  private readonly ptyManager: PtyManager | null;
  private readonly ptyTerminationTimeoutMs: number;

  constructor(options: LaneManagerOptions = {}) {
    this.registry = new LaneRegistry(options.capacityLimit ?? 50);
    this.bus = options.bus ?? null;
    this.ptyManager = options.ptyManager ?? null;
    this.ptyTerminationTimeoutMs = options.ptyTerminationTimeoutMs ?? 5000;
  }

  /** Expose registry for testing / sharing module integration. */
  getRegistry(): LaneRegistry {
    return this.registry;
  }

  // ── T003: create ─────────────────────────────────────────────────────────

  async create(workspaceId: string, baseBranch: string): Promise<LaneRecord> {
    const laneId = generateLaneId();

    return withLaneLock(laneId, async () => {
      const now = new Date().toISOString();
      const record: LaneRecord = {
        laneId,
        workspaceId,
        state: "new",
        worktreePath: null,
        parTaskPid: null,
        attachedAgents: [],
        baseBranch,
        createdAt: now,
        updatedAt: now,
      };

      this.registry.register(record);

      await this.emitEvent("lane.create.started", laneId, workspaceId, "new", "new");

      // Transition new -> provisioning
      const fromState: LaneState = "new";
      const toState = transition(fromState, "create", laneId);
      recordTransition(laneId, fromState, "create", toState);
      this.registry.update(laneId, { state: toState });

      await this.emitEvent("lane.created", laneId, workspaceId, fromState, toState);

      const updated = this.registry.get(laneId);
      return updated!;
    });
  }

  // ── T006+T010: provision worktree for a lane in provisioning state ──────

  async provision(laneId: string, workspaceRepoPath: string): Promise<LaneRecord> {
    return withLaneLock(laneId, async () => {
      const lane = this.registry.get(laneId);
      if (!lane) throw new LaneNotFoundError(laneId);
      if (lane.state !== "provisioning") {
        throw new Error(`Cannot provision lane in state ${lane.state}`);
      }

      try {
        const result = await provisionWorktree({
          workspaceRepoPath,
          laneId,
          baseBranch: lane.baseBranch,
        });

        // Transition provisioning -> ready
        const fromState = lane.state;
        const toState = transition(fromState, "provision_complete", laneId);
        recordTransition(laneId, fromState, "provision_complete", toState);
        this.registry.update(laneId, {
          state: toState,
          worktreePath: result.worktreePath,
        });

        await this.emitEvent(
          "lane.worktree.provisioned",
          laneId,
          lane.workspaceId,
          fromState,
          toState
        );
        await this.emitEvent("lane.state.changed", laneId, lane.workspaceId, fromState, toState);
        return this.registry.get(laneId)!;
      } catch {
        // T010: Partial provisioning failure - clean up and close lane
        const fromState = lane.state;
        const toState = transition(fromState, "provision_failed", laneId);
        recordTransition(laneId, fromState, "provision_failed", toState);
        this.registry.update(laneId, { state: toState });

        await this.emitEvent("lane.provision_failed", laneId, lane.workspaceId, fromState, toState);

        throw err;
      }
    });
  }

  // ── T003: list ───────────────────────────────────────────────────────────

  list(workspaceId?: string): LaneRecord[] {
    if (workspaceId !== undefined) {
      return this.registry.getByWorkspace(workspaceId);
    }
    return this.registry.list();
  }

  // ── T003: attach ─────────────────────────────────────────────────────────

  async attach(laneId: string, agentId: string): Promise<void> {
    await attachAgent(this.registry, laneId, agentId);
  }

  // ── T003: detach ─────────────────────────────────────────────────────────

  async detach(laneId: string, agentId: string): Promise<void> {
    const result = await detachAgent(this.registry, laneId, agentId);
    if (result.transitioned && result.fromState !== undefined && result.toState !== undefined) {
      const lane = this.registry.get(laneId);
      await this.emitEvent(
        "lane.state.changed",
        laneId,
        lane?.workspaceId ?? "",
        result.fromState,
        result.toState
      );
    }
  }

  // ── T005: share ──────────────────────────────────────────────────────────

  async share(laneId: string): Promise<void> {
    const result = await shareLane(this.registry, laneId);
    if (result.fromState !== result.toState) {
      const lane = this.registry.get(laneId);
      await this.emitEvent(
        "lane.shared",
        laneId,
        lane?.workspaceId ?? "",
        result.fromState,
        result.toState
      );
    }
  }

  // ── T003: cleanup ────────────────────────────────────────────────────────

  async cleanup(laneId: string, force: boolean = false): Promise<void> {
    await withLaneLock(laneId, async () => {
      const lane = this.registry.get(laneId);
      if (!lane) {
        // Idempotent: already cleaned up / non-existent
        return;
      }

      // Already closed: idempotent
      if (lane.state === "closed") {
        return;
      }

      // Already cleaning: idempotent
      if (lane.state === "cleaning") {
        // Still complete the cleanup
        const closedState = transition("cleaning", "cleanup_complete", laneId);
        recordTransition(laneId, "cleaning", "cleanup_complete", closedState);
        this.registry.update(laneId, { state: closedState });
        await this.emitEvent("lane.closed", laneId, lane.workspaceId, "cleaning", closedState);
        return;
      }

      // Shared lane with active agents
      if (lane.state === "shared" && lane.attachedAgents.length > 0) {
        if (force) {
          // Force-detach all agents, transition shared -> ready -> cleaning -> closed
          this.registry.update(laneId, { attachedAgents: [] });
          const midState = transition(lane.state, "unshare", laneId);
          recordTransition(laneId, lane.state, "unshare", midState);
          this.registry.update(laneId, { state: midState });
          const cleaningState = transition(midState, "request_cleanup", laneId);
          recordTransition(laneId, midState, "request_cleanup", cleaningState);
          this.registry.update(laneId, { state: cleaningState });
          await this.emitEvent(
            "lane.cleaning",
            laneId,
            lane.workspaceId,
            lane.state,
            cleaningState
          );
        } else {
          throw new SharedLaneCleanupError(laneId, lane.attachedAgents.length);
        }
      } else {
        // Normal cleanup transition
        const fromState = lane.state;
        const toState = transition(fromState, "request_cleanup", laneId);
        recordTransition(laneId, fromState, "request_cleanup", toState);
        this.registry.update(laneId, { state: toState });
        await this.emitEvent("lane.cleaning", laneId, lane.workspaceId, fromState, toState);
      }

      // T008: Terminate PTYs before worktree removal
      await this.terminateLanePtys(laneId, lane.workspaceId);

      // T007: Remove worktree if one was provisioned
      const currentLane = this.registry.get(laneId)!;
      if (currentLane.worktreePath) {
        try {
          // Infer workspaceRepoPath from worktreePath
          // worktreePath = <workspaceRepoPath>/.helios-worktrees/<laneId>
          const worktreeParent = path.dirname(currentLane.worktreePath);
          const workspaceRepoPath = path.dirname(worktreeParent);
          await removeWorktree(currentLane.worktreePath, workspaceRepoPath);
          await this.emitEvent(
            "lane.worktree.removed",
            laneId,
            lane.workspaceId,
            "cleaning",
            "cleaning"
          );
        } catch {
          // Best-effort: worktree may already be removed
        }
        this.registry.update(laneId, { worktreePath: null });
      }

      // Transition cleaning -> closed
      const updatedLane = this.registry.get(laneId)!;
      const cleaningFrom = updatedLane.state;
      const closedState = transition(cleaningFrom, "cleanup_complete", laneId);
      recordTransition(laneId, cleaningFrom, "cleanup_complete", closedState);
      this.registry.update(laneId, { state: closedState });
      await this.emitEvent("lane.closed", laneId, lane.workspaceId, cleaningFrom, closedState);
    });
  }

  // ── T008: Graceful PTY termination before worktree removal ───────────────

  private async terminateLanePtys(laneId: string, workspaceId: string): Promise<void> {
    if (!this.ptyManager) return;

    let ptys: PtyHandle[];
    try {
      ptys = this.ptyManager.getByLane(laneId);
    } catch {
      // PTY manager unavailable - proceed with best effort
      return;
    }

    if (ptys.length === 0) return;

    let _forceKilled = 0;
    const terminationPromises = ptys.map(async pty => {
      try {
        const timeout = new Promise<"timeout">(resolve =>
          setTimeout(() => resolve("timeout"), this.ptyTerminationTimeoutMs)
        );
        const termination = this.ptyManager!.terminate(pty.ptyId).then(() => "done" as const);
        const result = await Promise.race([termination, timeout]);
        if (result === "timeout") {
          forceKilled++;
        }
      } catch {
        forceKilled++;
      }
    });

    await Promise.all(terminationPromises);

    await this.emitEvent("lane.ptys_terminated", laneId, workspaceId, "cleaning", "cleaning");
  }

  // ── T016: Full orphaned lane reconciliation on startup ─────────────────

  async reconcileOrphans(
    workspaceRepoPath: string,
    options?: { timeoutMs?: number }
  ): Promise<FullReconciliationResult> {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const _startTime = Date.now();

    const result: FullReconciliationResult = {
      orphanedWorktrees: 0,
      orphanedRecords: 0,
      orphanedParTasks: 0,
      orphanedPtys: 0,
      totalCleaned: 0,
      cleaned: 0,
      timedOut: false,
    };

    const isTimedOut = (): boolean => Date.now() - startTime >= timeoutMs;

    try {
      // Phase 1: Scan worktree directories vs registry
      const knownLaneIds = new Set<string>();
      const activeLanes = this.registry.getActive();
      for (const lane of activeLanes) {
        knownLaneIds.add(lane.laneId);
      }

      if (!isTimedOut()) {
        const worktreeResult = await reconcileOrphanedWorktrees(
          workspaceRepoPath,
          knownLaneIds,
          (laneId: string) => {
            try {
              this.registry.update(laneId, { state: "closed" });
            } catch {
              // Lane may not exist in registry
            }
          }
        );
        result.orphanedWorktrees = worktreeResult.orphanedWorktrees;
        result.cleaned += worktreeResult.cleaned;
        result.totalCleaned += worktreeResult.cleaned;
      }

      // Phase 1b: Registry entries without worktrees
      if (!isTimedOut()) {
        const fsModule = await import("node:fs");
        for (const lane of activeLanes) {
          if (isTimedOut()) break;
          if (lane.worktreePath && !fsModule.existsSync(lane.worktreePath)) {
            result.orphanedRecords++;
            result.totalCleaned++;
            this.registry.update(lane.laneId, {
              state: "closed",
              worktreePath: null,
            });
          }
        }
      }

      // Phase 2: Orphaned par tasks - check for parTaskPid entries with no running process
      if (!isTimedOut()) {
        const allLanes = this.registry.list();
        for (const lane of allLanes) {
          if (isTimedOut()) break;
          if (lane.parTaskPid !== null && lane.state !== "closed") {
            // Check if the process is still alive
            try {
              process.kill(lane.parTaskPid, 0);
            } catch {
              // Process does not exist - orphaned par task
              result.orphanedParTasks++;
              result.totalCleaned++;
              this.registry.update(lane.laneId, { parTaskPid: null });
            }
          }
        }
      }

      // Phase 3: Orphaned PTYs - delegate to ptyManager if available
      if (!isTimedOut() && this.ptyManager) {
        const closedLanes = this.registry.list().filter(l => l.state === "closed");
        for (const lane of closedLanes) {
          if (isTimedOut()) break;
          try {
            const ptys = this.ptyManager.getByLane(lane.laneId);
            for (const pty of ptys) {
              result.orphanedPtys++;
              result.totalCleaned++;
              try {
                await this.ptyManager.terminate(pty.ptyId);
              } catch {
                // Best-effort
              }
            }
          } catch {
            // PTY manager unavailable
          }
        }
      }
    } catch {
      // Partial reconciliation - log and continue
    }

    if (isTimedOut()) {
      result.timedOut = true;
    }

    // Publish reconciliation.completed event
    await this.emitReconciliationEvent(result);

    return result;
  }

  private async emitReconciliationEvent(result: FullReconciliationResult): Promise<void> {
    if (!this.bus) return;

    const envelope: LocalBusEnvelope = {
      id: `reconciliation:${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "reconciliation.completed",
      payload: {
        orphanedWorktrees: result.orphanedWorktrees,
        orphanedRecords: result.orphanedRecords,
        orphanedParTasks: result.orphanedParTasks,
        orphanedPtys: result.orphanedPtys,
        totalCleaned: result.totalCleaned,
        timedOut: result.timedOut,
      },
    };

    try {
      await this.bus.publish(envelope);
    } catch {
      // Fire-and-forget
    }
  }

  // ── T004: Event Publishing ───────────────────────────────────────────────

  private async emitEvent(
    topic: LaneBusEventTopic,
    laneId: string,
    workspaceId: string,
    fromState: LaneState,
    toState: LaneState
  ): Promise<void> {
    if (!this.bus) return;

    const envelope: LocalBusEnvelope = {
      id: `${laneId}:${topic}:${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      workspace_id: workspaceId,
      lane_id: laneId,
      correlation_id: laneId,
      topic,
      payload: {
        laneId,
        workspaceId,
        fromState,
        toState,
        correlationId: laneId,
      },
    };

    try {
      await this.bus.publish(envelope);
    } catch {
      // T004: Bus failures do not block lane operations (fire-and-forget)
    }
  }
}

// Re-export public types
export { LaneRegistry, type LaneRecord, LaneNotFoundError } from "./registry.js";
export type { LaneState, LaneEvent } from "./state_machine.js";
export {
  InvalidLaneTransitionError,
  transition,
  withLaneLock,
  getTransitionHistory,
} from "./state_machine.js";
export { LaneClosedError, SharedLaneCleanupError } from "./sharing.js";
export {
  provisionWorktree,
  removeWorktree,
  reconcileOrphanedWorktrees,
  WorktreeProvisionError,
  WorktreeCleanupError,
  computeWorktreePath,
  computeBranchName,
  type WorktreeOptions,
  type WorktreeResult,
  type ReconciliationResult,
} from "./worktree.js";
export {
  ParManager,
  ParNotFoundError,
  ParSpawnError,
  LaneNotReadyError,
  ExecTimeoutError,
  _resetParIdCounter,
  type ParBinding,
  type ExecResult,
  type ParManagerOptions,
  type SpawnFn,
  type SpawnResult,
} from "./par.js";
