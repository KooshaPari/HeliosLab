// T011-T014 - Par task binding, termination, execution, and stale detection

import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import type { LaneRegistry } from "./registry.js";
import { transition, withLaneLock, recordTransition, type LaneState } from "./state_machine.js";
import {
  type ParBinding,
  type ExecResult,
  type ParManagerOptions,
  type SpawnFn,
  type SpawnResult,
  ParNotFoundError,
  ParSpawnError,
  LaneNotReadyError,
  ExecTimeoutError,
  generateParTaskId,
  isProcessAlive,
  defaultSpawn,
} from "./par-types.js";

export type {
  ParBinding,
  ExecResult,
  ParManagerOptions,
  SpawnFn,
  SpawnResult,
} from "./par-types.js";
export {
  ParNotFoundError,
  ParSpawnError,
  LaneNotReadyError,
  ExecTimeoutError,
  _resetParIdCounter,
} from "./par-types.js";

// ── Par Manager ─────────────────────────────────────────────────────────────

export class ParManager {
  private readonly bindings = new Map<string, ParBinding>();
  private readonly registry: LaneRegistry;
  private readonly bus: LocalBus | null;
  private readonly staleTimeoutMs: number;
  private readonly forceKillTimeoutMs: number;
  private readonly healthCheckIntervalMs: number;
  private readonly execTimeoutMs: number;
  private readonly spawnFn: SpawnFn;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  // Track live process handles for termination
  private readonly processHandles = new Map<string, SpawnResult>();

  constructor(options: ParManagerOptions) {
    this.registry = options.registry;
    this.bus = options.bus ?? null;
    this.staleTimeoutMs = options.staleTimeoutMs ?? 30_000;
    this.forceKillTimeoutMs = options.forceKillTimeoutMs ?? 10_000;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 15_000;
    this.execTimeoutMs = options.execTimeoutMs ?? 300_000;
    this.spawnFn = options.spawnFn ?? defaultSpawn;
  }

  // ── T011: Bind par task to lane ─────────────────────────────────────────

  async bindParTask(laneId: string, worktreePath: string): Promise<ParBinding> {
    const lane = this.registry.get(laneId);
    if (!lane) {
      throw new ParSpawnError(laneId, "Lane not found");
    }

    const parTaskId = generateParTaskId();
    let proc: SpawnResult;

    try {
      proc = this.spawnFn(["par", "task", "create", "--cwd", worktreePath], {
        cwd: worktreePath,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      throw new ParSpawnError(laneId, err instanceof Error ? err.message : String(err));
    }

    const pid = proc.pid;
    if (!pid || pid <= 0) {
      throw new ParSpawnError(laneId, "Failed to capture par process PID");
    }

    const now = new Date();
    const binding: ParBinding = {
      laneId,
      parTaskId,
      pid,
      worktreePath,
      startedAt: now,
      status: "active",
      lastHeartbeat: now,
    };

    this.bindings.set(laneId, binding);
    this.processHandles.set(laneId, proc);

    // Update lane record with par PID
    this.registry.update(laneId, { parTaskPid: pid });

    // Monitor for unexpected exit
    proc.exited
      .then(exitCode => {
        const current = this.bindings.get(laneId);
        if (current && current.status === "active") {
          current.status = "terminated";
          this.registry.update(laneId, { parTaskPid: null });
          this.processHandles.delete(laneId);
          this.emitParEvent("lane.par_task.terminated", laneId, lane.workspaceId, {
            parTaskId,
            pid,
            exitCode,
            reason: "unexpected_exit",
          });
        }
      })
      .catch(() => {
        // Process monitoring failed - will be caught by health check
      });

    await this.emitParEvent("lane.par_task.bound", laneId, lane.workspaceId, {
      parTaskId,
      pid,
      worktreePath,
    });

    return binding;
  }

  // ── T012: Terminate par task ────────────────────────────────────────────

  async terminateParTask(laneId: string): Promise<void> {
    const binding = this.bindings.get(laneId);
    if (!binding) {
      // Already terminated or never bound - idempotent no-op
      return;
    }

    if (binding.status === "terminated") {
      this.bindings.delete(laneId);
      this.processHandles.delete(laneId);
      this.registry.update(laneId, { parTaskPid: null });
      return;
    }

    const proc = this.processHandles.get(laneId);
    const lane = this.registry.get(laneId);
    const workspaceId = lane?.workspaceId ?? "";

    if (proc) {
      // Send SIGTERM
      try {
        proc.kill(15); // SIGTERM
      } catch {
        // Process may already be gone
      }

      // Wait for graceful exit or force kill
      const exited = await Promise.race([
        proc.exited.then(() => true).catch(() => true),
        new Promise<false>(resolve => setTimeout(() => resolve(false), this.forceKillTimeoutMs)),
      ]);

      if (!exited) {
        // Force kill with SIGKILL
        try {
          proc.kill(9); // SIGKILL
        } catch {
          // Process may already be gone
        }
        await this.emitParEvent("lane.par_task.force_killed", laneId, workspaceId, {
          parTaskId: binding.parTaskId,
          pid: binding.pid,
        });
      }
    }

    binding.status = "terminated";
    this.bindings.delete(laneId);
    this.processHandles.delete(laneId);
    this.registry.update(laneId, { parTaskPid: null });

    await this.emitParEvent("lane.par_task.terminated", laneId, workspaceId, {
      parTaskId: binding.parTaskId,
      pid: binding.pid,
      reason: "cleanup",
    });
  }

  // ── T013: Execute command in lane ───────────────────────────────────────

  async executeInLane(laneId: string, command: string[]): Promise<ExecResult> {
    return withLaneLock(laneId, async () => {
      const lane = this.registry.get(laneId);
      if (!lane) {
        throw new LaneNotReadyError(laneId, "not_found");
      }

      if (lane.state !== "ready" && lane.state !== "shared") {
        throw new LaneNotReadyError(laneId, lane.state);
      }

      const binding = this.bindings.get(laneId);
      if (!binding || binding.status !== "active") {
        throw new ParNotFoundError(laneId);
      }

      // Transition to running
      const fromState = lane.state as LaneState;
      const runningState = transition(fromState, "start_running", laneId);
      recordTransition(laneId, fromState, "start_running", runningState);
      this.registry.update(laneId, { state: runningState });

      await this.emitParEvent("lane.command.started", laneId, lane.workspaceId, {
        command,
        parTaskId: binding.parTaskId,
      });

      const start = performance.now();

      try {
        const proc = this.spawnFn(["par", "exec", "--task", binding.parTaskId, "--", ...command], {
          cwd: binding.worktreePath,
          stdout: "pipe",
          stderr: "pipe",
        });

        // Race execution against timeout
        const timeoutPromise = new Promise<"timeout">(resolve =>
          setTimeout(() => resolve("timeout"), this.execTimeoutMs)
        );

        const exitPromise = proc.exited;
        const result = await Promise.race([
          exitPromise.then(code => ({ type: "done" as const, code })),
          timeoutPromise.then(() => ({ type: "timeout" as const, code: -1 })),
        ]);

        if (result.type === "timeout") {
          try {
            proc.kill(9);
          } catch {
            // already gone
          }

          // Transition back to ready
          const currentState = this.registry.get(laneId)!.state as LaneState;
          const readyState = transition(currentState, "command_complete", laneId);
          recordTransition(laneId, currentState, "command_complete", readyState);
          this.registry.update(laneId, { state: readyState });

          await this.emitParEvent("lane.command.timeout", laneId, lane.workspaceId, {
            command,
            timeoutMs: this.execTimeoutMs,
          });

          throw new ExecTimeoutError(laneId, this.execTimeoutMs);
        }

        const [stdout, stderr] = await Promise.all([
          proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
          proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
        ]);

        const duration = performance.now() - start;

        // Transition back to ready
        const currentState = this.registry.get(laneId)!.state as LaneState;
        const readyState = transition(currentState, "command_complete", laneId);
        recordTransition(laneId, currentState, "command_complete", readyState);
        this.registry.update(laneId, { state: readyState });

        const execResult: ExecResult = {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: result.code,
          duration,
        };

        await this.emitParEvent("lane.command.completed", laneId, lane.workspaceId, {
          command,
          exitCode: result.code,
          duration,
        });

        return execResult;
      } catch (err) {
        // If it's our own timeout error, re-throw
        if (err instanceof ExecTimeoutError) throw err;

        // Transition back to ready on unexpected error
        try {
          const currentLane = this.registry.get(laneId);
          if (currentLane && currentLane.state === "running") {
            const readyState = transition("running", "command_complete", laneId);
            recordTransition(laneId, "running", "command_complete", readyState);
            this.registry.update(laneId, { state: readyState });
          }
        } catch {
          // Transition failed - lane may be in inconsistent state
        }
        throw err;
      }
    });
  }

  // ── T014: Stale detection and health check ──────────────────────────────

  startHealthCheck(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck().catch(() => {
        // Health check error - will retry next cycle
      });
    }, this.healthCheckIntervalMs);
  }

  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  async runHealthCheck(): Promise<void> {
    for (const [laneId, binding] of this.bindings) {
      if (binding.status !== "active") continue;

      const lane = this.registry.get(laneId);
      const workspaceId = lane?.workspaceId ?? "";

      // Check if PID is still alive
      const alive = isProcessAlive(binding.pid);

      if (!alive) {
        // Process is gone but binding still exists
        binding.status = "terminated";
        this.bindings.delete(laneId);
        this.processHandles.delete(laneId);
        this.registry.update(laneId, { parTaskPid: null });

        await this.emitParEvent("lane.par_task.terminated", laneId, workspaceId, {
          parTaskId: binding.parTaskId,
          pid: binding.pid,
          reason: "dead_process_detected",
        });
        continue;
      }

      // Check heartbeat staleness
      const elapsed = Date.now() - binding.lastHeartbeat.getTime();
      if (elapsed > this.staleTimeoutMs) {
        binding.status = "stale";

        await this.emitParEvent("lane.par_task.stale", laneId, workspaceId, {
          parTaskId: binding.parTaskId,
          pid: binding.pid,
          elapsedMs: elapsed,
        });

        // Force-kill stale task
        await this.terminateParTask(laneId);

        await this.emitParEvent("lane.par_task.force_killed", laneId, workspaceId, {
          parTaskId: binding.parTaskId,
          pid: binding.pid,
          reason: "stale_timeout",
        });
      }
    }
  }

  /** Update heartbeat for a par binding (e.g. from par's heartbeat signal). */
  updateHeartbeat(laneId: string): void {
    const binding = this.bindings.get(laneId);
    if (binding && binding.status === "active") {
      binding.lastHeartbeat = new Date();
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────────

  getBinding(laneId: string): ParBinding | undefined {
    const b = this.bindings.get(laneId);
    return b ? { ...b } : undefined;
  }

  getAllBindings(): ParBinding[] {
    return [...this.bindings.values()].map(b => ({ ...b }));
  }

  // ── Event Publishing ──────────────────────────────────────────────────

  private async emitParEvent(
    topic: string,
    laneId: string,
    workspaceId: string,
    extra: Record<string, unknown>
  ): Promise<void> {
    if (!this.bus) return;

    const envelope: LocalBusEnvelope = {
      id: `${laneId}:${topic}:${Date.now()}`,
      type: "event",
      ts: new Date().toISOString(),
      workspace_id: workspaceId,
      lane_id: laneId,
      topic,
      payload: {
        laneId,
        workspaceId,
        timestamp: new Date().toISOString(),
        correlationId: laneId,
        ...extra,
      },
    };

    try {
      await this.bus.publish(envelope);
    } catch {
      // Bus failures do not block par operations
    }
  }
}
