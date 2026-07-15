/**
 * PTY idle timeout detection — transitions idle PTYs to `throttled`.
 *
 * Monitors output timestamps and runs periodic checks to detect
 * PTYs that have stopped producing output.
 *
 * @module
 */

import { PtyRegistry } from "./registry.js";

import { PtyLifecycle } from "./state_machine.js";
import type { BusPublisher, PtyEventCorrelation } from "./events.js";
import { emitPtyEvent } from "./events.js";

/** Configuration for the idle monitor. */
export interface IdleMonitorConfig {
  /** Default idle timeout in ms (default: 300000 = 5 minutes). */
  defaultTimeoutMs?: number;
  /** Polling interval in ms (default: 30000 = 30 seconds). */
  pollIntervalMs?: number;
}

/**
 * Tracks output timestamps and idle timeout settings per-PTY.
 */
export class IdleMonitor {
  private readonly lastOutputTs = new Map<string, number>();
  private readonly disabledPtys = new Set<string>();
  private readonly perPtyTimeout = new Map<string, number>();
  private readonly defaultTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Lifecycle instances keyed by ptyId, needed for state transitions. */
  private readonly lifecycles: Map<string, PtyLifecycle>;

  private readonly registry: PtyRegistry;
  private readonly bus: BusPublisher;

  constructor(
    registry: PtyRegistry,
    bus: BusPublisher,
    lifecycles: Map<string, PtyLifecycle>,
    config?: IdleMonitorConfig
  ) {
    this.registry = registry;
    this.bus = bus;
    this.lifecycles = lifecycles;
    this.defaultTimeoutMs = config?.defaultTimeoutMs ?? 300_000;
    this.pollIntervalMs = config?.pollIntervalMs ?? 30_000;
  }

  /**
   * Record output activity for a PTY. If the PTY was in `throttled`
   * state, transitions it back to `active`.
   */
  recordOutput(ptyId: string): void {
    this.lastOutputTs.set(ptyId, Date.now());

    const record = this.registry.get(ptyId);
    if (record && record.state === "throttled") {
      const lifecycle = this.lifecycles.get(ptyId);
      if (lifecycle && lifecycle.state === "throttled") {
        try {
          lifecycle.apply("output_resume");
          this.registry.update(ptyId, { state: "active" });

          const correlation: PtyEventCorrelation = {
            ptyId,
            laneId: record.laneId,
            sessionId: record.sessionId,
            terminalId: record.terminalId,
            correlationId: crypto.randomUUID(),
          };
          emitPtyEvent(this.bus, "pty.state.changed", correlation, {
            from: "throttled",
            to: "active",
            reason: "output_resumed",
          });
        } catch {
          // State transition error — ignore.
        }
      }
    }
  }

  /**
   * Disable idle timeout for a specific PTY (long-running processes).
   */
  disableFor(ptyId: string): void {
    this.disabledPtys.add(ptyId);
  }

  /**
   * Re-enable idle timeout for a specific PTY.
   */
  enableFor(ptyId: string): void {
    this.disabledPtys.delete(ptyId);
  }

  /**
   * Set a custom idle timeout for a specific PTY.
   */
  setTimeoutFor(ptyId: string, timeoutMs: number): void {
    this.perPtyTimeout.set(ptyId, timeoutMs);
  }

  /**
   * Remove tracking for a PTY (called on cleanup).
   */
  remove(ptyId: string): void {
    this.lastOutputTs.delete(ptyId);
    this.disabledPtys.delete(ptyId);
    this.perPtyTimeout.delete(ptyId);
  }

  /**
   * Start the periodic idle check.
   */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.checkIdle();
    }, this.pollIntervalMs);
  }

  /**
   * Stop the periodic idle check.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single idle check across all active PTYs.
   * Exposed for testing — normally called by the interval timer.
   */
  checkIdle(): void {
    const now = Date.now();
    const allRecords = this.registry.list();

    for (const record of allRecords) {
      if (record.state !== "active") continue;
      if (this.disabledPtys.has(record.ptyId)) continue;

      const lastOutput = this.lastOutputTs.get(record.ptyId);
      // If we have no record of output, use the record creation time.
      const lastActivity = lastOutput ?? record.createdAt;
      const timeout = this.perPtyTimeout.get(record.ptyId) ?? this.defaultTimeoutMs;
      const idleDuration = now - lastActivity;

      if (idleDuration >= timeout) {
        const lifecycle = this.lifecycles.get(record.ptyId);
        if (lifecycle && lifecycle.state === "active") {
          try {
            lifecycle.apply("idle_timeout");
            this.registry.update(record.ptyId, { state: "throttled" });

            const correlation: PtyEventCorrelation = {
              ptyId: record.ptyId,
              laneId: record.laneId,
              sessionId: record.sessionId,
              terminalId: record.terminalId,
              correlationId: crypto.randomUUID(),
            };
            emitPtyEvent(this.bus, "pty.idle_timeout", correlation, {
              idleDurationMs: idleDuration,
              timeoutMs: timeout,
            });
            emitPtyEvent(this.bus, "pty.state.changed", correlation, {
              from: "active",
              to: "throttled",
              reason: "idle_timeout",
            });
          } catch {
            // State transition conflict (e.g., PTY exited during check) — ignore.
          }
        }
      }
    }
  }
}
