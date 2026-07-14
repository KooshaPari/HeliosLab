/**
 * PTY Lifecycle Manager — public API surface.
 *
 * Re-exports types and provides the {@link PtyManager} facade
 * for all PTY operations.
 *
 * @module
 */

export {
  type PtyState,
  type PtyEvent,
  type TransitionRecord,
  PtyLifecycle,
  InvalidTransitionError,
  transition,
} from "./state_machine.js";

export {
  type PtyRecord,
  type PtyDimensions,
  type ReconciliationSummary,
  PtyRegistry,
  DuplicatePtyError,
  RegistryCapacityError,
} from "./registry.js";

export { type SpawnOptions, type SpawnResult, spawnPty } from "./spawn.js";

export {
  type SignalEnvelope,
  SignalHistory,
  type SignalHistoryMap,
  InvalidDimensionsError,
  type TerminateOptions,
  resize,
  terminate,
  sendSighup,
} from "./signals.js";

export {
  type PtyEventCorrelation,
  type PtyEventTopic,
  type PtyBusEvent,
  type BusPublisher,
  NoOpBusPublisher,
  InMemoryBusPublisher,
  emitPtyEvent,
} from "./events.js";

export { InvalidStateError, type WriteResult, type ProcessMap, writeInput } from "./io.js";

export { IdleMonitor, type IdleMonitorConfig } from "./idle_monitor.js";

export {
  RingBuffer,
  type RingWriteResult,
  OutputBuffer,
  type OutputBufferConfig,
  type BufferStats,
} from "./buffers.js";

// Local imports for use in PtyManager class body.
import { PtyRegistry as _PtyRegistry } from "./registry.js";
import { PtyLifecycle as _PtyLifecycle } from "./state_machine.js";
import { spawnPty as _spawnPty } from "./spawn.js";
import type { SpawnOptions as _SpawnOptions } from "./spawn.js";
import type { PtyRecord as _PtyRecord } from "./registry.js";
import type { ReconciliationSummary as _ReconciliationSummary } from "./registry.js";
import type { BusPublisher as _BusPublisher } from "./events.js";
import { NoOpBusPublisher as _NoOpBusPublisher, emitPtyEvent as _emitPtyEvent } from "./events.js";
import type { SignalHistoryMap as _SignalHistoryMap } from "./signals.js";
import {
  resize as _resize,
  terminate as _terminate,
  type TerminateOptions as _TerminateOptions,
} from "./signals.js";
import { writeInput as _writeInput, type ProcessMap as _ProcessMap } from "./io.js";
import {
  IdleMonitor as _IdleMonitor,
  type IdleMonitorConfig as _IdleMonitorConfig,
} from "./idle_monitor.js";
import {
  OutputBuffer as _OutputBuffer,
  type OutputBufferConfig as _OutputBufferConfig,
  type BufferStats as _BufferStats,
} from "./buffers.js";

/**
 * High-level facade for PTY operations.
 *
 * Wraps the state machine, registry, spawn, I/O, signals, and idle
 * monitoring into a single entry point consumed by upstream specs (008, 009).
 */
export class PtyManager {
  /** The underlying process registry. */
  public readonly registry: _PtyRegistry;

  /** Bus publisher for lifecycle events. */
  public readonly bus: _BusPublisher;

  /** Lifecycle state machines keyed by ptyId. */
  private readonly lifecycles = new Map<string, _PtyLifecycle>();

  /** Process handles keyed by ptyId. */
  private readonly processes: _ProcessMap = new Map();

  /** Signal history keyed by ptyId. */
  private readonly signalHistories: _SignalHistoryMap = new Map();

  /** Idle monitor instance. */
  public readonly idleMonitor: _IdleMonitor;

  /** Output buffers keyed by ptyId. */
  private readonly outputBuffers = new Map<string, _OutputBuffer>();

  /** Default output buffer configuration. */
  private readonly bufferConfig: _OutputBufferConfig | undefined;

  /**
   * @param maxCapacity - Maximum number of concurrent PTYs (default 300).
   * @param bus - Bus publisher for lifecycle events (default: NoOpBusPublisher).
   * @param idleConfig - Idle monitor configuration.
   */
  constructor(
    maxCapacity = 300,
    bus?: _BusPublisher,
    idleConfig?: _IdleMonitorConfig,
    bufferConfig?: _OutputBufferConfig
  ) {
    this.bufferConfig = bufferConfig;
    this.registry = new _PtyRegistry(maxCapacity);
    this.bus = bus ?? new _NoOpBusPublisher();
    this.idleMonitor = new _IdleMonitor(this.registry, this.bus, this.lifecycles, idleConfig);
  }

  /**
   * Spawn a new PTY process and register it.
   *
   * @param options - Spawn configuration.
   * @returns The newly created {@link PtyRecord}.
   */
  async spawn(options: _SpawnOptions): Promise<_PtyRecord> {
    const result = await _spawnPty(options, this.registry);
    const _record = result.record;

    // Track lifecycle and process handle.
    const lifecycle = new _PtyLifecycle(record.ptyId, "active");
    this.lifecycles.set(record.ptyId, lifecycle);

    // Store process handle for I/O.
    // Note: We need to re-spawn to get the handle. In practice the spawn
    // function should return the subprocess. For now, store a stub.
    // The real process is tracked via the record's pid.

    const correlation = {
      ptyId: record.ptyId,
      laneId: record.laneId,
      sessionId: record.sessionId,
      terminalId: record.terminalId,
      correlationId: crypto.randomUUID(),
    };

    _emitPtyEvent(this.bus, "pty.spawned", correlation, {
      pid: record.pid,
      shell: options.shell ?? "/bin/bash",
      dimensions: record.dimensions,
      spawnLatencyMs: result.spawnLatencyMs,
    });

    _emitPtyEvent(this.bus, "pty.state.changed", correlation, {
      from: "idle",
      to: "active",
      reason: "spawn_succeeded",
    });

    // Initialize idle monitor tracking.
    this.idleMonitor.recordOutput(record.ptyId);

    // Create output buffer for this PTY.
    const outputBuffer = new _OutputBuffer(this.bus, correlation, this.bufferConfig);
    this.outputBuffers.set(record.ptyId, outputBuffer);

    return record;
  }

  /**
   * Register a subprocess handle for a PTY (for I/O operations).
   * Must be called after spawn if writeInput is needed.
   */
  registerProcess(
    ptyId: string,
    proc: { readonly stdin: { write(data: Uint8Array | string): number } }
  ): void {
    this.processes.set(ptyId, proc);
  }

  /**
   * Look up a PTY record by ID.
   *
   * @param ptyId - The PTY ID.
   * @returns The record, or `undefined` if not found.
   */
  get(ptyId: string): _PtyRecord | undefined {
    return this.registry.get(ptyId);
  }

  /**
   * Get all PTY records for a given lane.
   *
   * @param laneId - The lane ID.
   * @returns An array of matching records.
   */
  getByLane(laneId: string): _PtyRecord[] {
    return this.registry.getByLane(laneId);
  }

  /**
   * Write input data to a PTY.
   *
   * @param ptyId - The PTY ID.
   * @param data - The data to write.
   * @throws {InvalidStateError} if the PTY is not in a writable state.
   */
  writeInput(ptyId: string, data: Uint8Array): void {
    const _record = this.registry.get(ptyId);
    if (!record) {
      throw new Error(`PTY '${ptyId}' not found`);
    }

    _writeInput(record, data, this.processes, this.bus, id => {
      const lifecycle = this.lifecycles.get(id);
      if (lifecycle && lifecycle.state === "active") {
        try {
          lifecycle.apply("unexpected_exit");
          this.registry.update(id, { state: "errored" });
        } catch {
          // Already transitioned.
        }
      }
    });
  }

  /**
   * Resize a PTY viewport.
   *
   * @param ptyId - The PTY ID.
   * @param cols - New column count.
   * @param rows - New row count.
   * @throws {InvalidDimensionsError} if dimensions are out of range.
   */
  resize(ptyId: string, cols: number, rows: number): void {
    const _record = this.registry.get(ptyId);
    if (!record) {
      throw new Error(`PTY '${ptyId}' not found`);
    }

    _resize(record, cols, rows, this.registry, this.signalHistories, this.bus);
  }

  /**
   * Terminate a PTY process gracefully.
   *
   * @param ptyId - The PTY ID.
   * @param options - Termination options.
   */
  async terminate(ptyId: string, options?: _TerminateOptions): Promise<void> {
    const _record = this.registry.get(ptyId);
    if (!record) {
      // Already removed — idempotent.
      return;
    }

    const lifecycle = this.lifecycles.get(ptyId);
    if (!lifecycle) {
      // No lifecycle — create one in current state for cleanup.
      const lc = new _PtyLifecycle(ptyId, record.state);
      this.lifecycles.set(ptyId, lc);
    }

    const lc = this.lifecycles.get(ptyId)!;

    await _terminate(record, lc, this.registry, this.signalHistories, this.bus, options);

    // Clean up internal maps.
    this.lifecycles.delete(ptyId);
    this.processes.delete(ptyId);
    this.outputBuffers.delete(ptyId);
    this.idleMonitor.remove(ptyId);
  }

  /**
   * Record output activity for a PTY (resets idle timer).
   */
  recordOutput(ptyId: string): void {
    this.idleMonitor.recordOutput(ptyId);
  }

  /**
   * Start the idle monitor.
   */
  startIdleMonitor(): void {
    this.idleMonitor.start();
  }

  /**
   * Stop the idle monitor.
   */
  stopIdleMonitor(): void {
    this.idleMonitor.stop();
  }

  /**
   * Get the output buffer for a PTY.
   *
   * @param ptyId - The PTY ID.
   * @returns The output buffer, or `undefined` if not found.
   */
  getOutputBuffer(ptyId: string): _OutputBuffer | undefined {
    return this.outputBuffers.get(ptyId);
  }

  /**
   * Get buffer statistics for a PTY.
   *
   * @param ptyId - The PTY ID.
   * @returns Buffer stats, or `undefined` if the PTY has no buffer.
   */
  getBufferStats(ptyId: string): _BufferStats | undefined {
    return this.outputBuffers.get(ptyId)?.getStats();
  }

  /**
   * Reconcile orphaned PTY processes on startup.
   *
   * @returns A reconciliation summary.
   */
  async reconcileOrphans(): Promise<_ReconciliationSummary> {
    return this.registry.reconcileOrphans();
  }
}
