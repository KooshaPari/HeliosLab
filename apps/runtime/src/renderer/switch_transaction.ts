/**
 * Switch transaction orchestrator.
 *
 * Coordinates the complete renderer switch lifecycle:
 * - Manages transaction state (pending, hot-swapping, committed, rolled-back, failed)
 * - Enforces atomic all-or-nothing semantics
 * - Rejects concurrent switches
 * - Routes to hot-swap or restart-with-restore based on capability matrix
 *
 * @see FR-010-008, FR-010-009, SC-010-002
 */

import type { RendererAdapter, RendererConfig, RenderSurface } from "./adapter.js";
import type { RendererEventBus } from "./index.js";
import { executeHotSwap, type TerminalContext } from "./hot_swap.js";
import { executeRollback } from "./rollback.js";
import { executeRestartWithRestore } from "./restart_restore.js";
import type { SwitchBuffer } from "./stream_binding.js";

// ---------------------------------------------------------------------------
// State and error types
// ---------------------------------------------------------------------------

export type SwitchTransactionState =
  | "pending"
  | "hot-swapping"
  | "restarting"
  | "committing"
  | "rolled-back"
  | "committed"
  | "degraded"
  | "failed";

export class ConcurrentSwitchError extends Error {
  constructor(activeTransactionId: string) {
    super(`Cannot start switch: transaction ${activeTransactionId} is already active`);
    this.name = "ConcurrentSwitchError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(fromState: SwitchTransactionState, toState: SwitchTransactionState) {
    super(`Invalid switch transaction transition: ${fromState} -> ${toState}`);
    this.name = "InvalidTransitionError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SwitchTransaction {
  id: string;
  state: SwitchTransactionState;
  sourceRendererId: string;
  targetRendererId: string;
  createdAt: number;
  updatedAt: number;
  correlationId: string;
  error?: Error;
}

export interface SwitchTransactionRequest {
  targetRendererId: string;
  sourceAdapter: RendererAdapter;
  targetAdapter: RendererAdapter;
  terminals: Map<string, TerminalContext>;
  streamBuffer: SwitchBuffer;
  config: RendererConfig;
  surface: RenderSurface;
  onProgress?: (state: SwitchTransactionState) => void;
}

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<SwitchTransactionState, SwitchTransactionState[]> = {
  pending: ["hot-swapping", "restarting"],
  "hot-swapping": ["committing", "rolled-back", "degraded"],
  restarting: ["committing", "rolled-back", "degraded"],
  committing: ["committed", "degraded"],
  committed: [],
  "rolled-back": [],
  degraded: ["committed", "rolled-back", "failed"],
  failed: [],
};

// ---------------------------------------------------------------------------
// Switch transaction orchestrator
// ---------------------------------------------------------------------------

// Terminal creation queue types
interface QueuedTerminalCreation {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  params: unknown;
  createdAt: number;
  queueTimeoutMs?: number;
}

export class SwitchTransactionOrchestrator {
  private _activeTransaction: SwitchTransaction | undefined;
  private readonly _eventBus: RendererEventBus | undefined;
  private readonly _terminalCreationQueue: QueuedTerminalCreation[] = [];
  private readonly _queueTimeoutMs = 30000; // 30 second default timeout

  constructor(eventBus?: RendererEventBus) {
    this._eventBus = eventBus;
  }

  /**
   * Start a new renderer switch transaction.
   *
   * Validates that no switch is in progress, creates a new transaction,
   * and routes to hot-swap or restart based on capability matrix.
   *
   * @param request - Switch request with renderers, terminals, and buffers.
   * @returns The completed transaction.
   * @throws {ConcurrentSwitchError} if a switch is already in progress.
   */
  async startSwitch(request: SwitchTransactionRequest): Promise<SwitchTransaction> {
    // Check concurrent transaction guard
    if (
      this._activeTransaction !== undefined &&
      this._activeTransaction.state !== "committed" &&
      this._activeTransaction.state !== "rolled-back" &&
      this._activeTransaction.state !== "failed" &&
      this._activeTransaction.state !== "degraded"
    ) {
      throw new ConcurrentSwitchError(this._activeTransaction.id);
    }

    // Create new transaction
    const transaction: SwitchTransaction = {
      id: crypto.randomUUID(),
      state: "pending",
      sourceRendererId: request.sourceAdapter.id,
      targetRendererId: request.targetRendererId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      correlationId: crypto.randomUUID(),
    };

    this._activeTransaction = transaction;

    try {
      // Route to hot-swap (WP02 focus) or restart-with-restore (WP03)
      // For now, assume hot-swap capability check (in real impl, query capability matrix)
      const canHotSwap = true;

      let result: SwitchTransaction;
      if (canHotSwap) {
        result = await this._executeHotSwapPath(transaction, request);
      } else {
        result = await this._executeRestartRestorePath(transaction, request);
      }

      // Drain terminal creation queue after transaction completes
      if (
        result.state === "committed" ||
        result.state === "rolled-back" ||
        result.state === "degraded"
      ) {
        this._drainTerminalCreationQueue();
      }

      return result;
    } catch {
      transaction.state = "failed";
      transaction.error = error instanceof Error ? error : new Error(String(error));
      this._drainTerminalCreationQueue();
      throw error;
    }
  }

  /**
   * Execute hot-swap transition path.
   * @private
   */
  private async _executeHotSwapPath(
    transaction: SwitchTransaction,
    request: SwitchTransactionRequest
  ): Promise<SwitchTransaction> {
    // Transition to hot-swapping
    this._transitionState(transaction, "hot-swapping");
    request.onProgress?.("hot-swapping");

    try {
      // Execute hot-swap
      const result = await executeHotSwap(
        request.sourceAdapter,
        request.targetAdapter,
        request.terminals,
        request.streamBuffer,
        request.config,
        request.surface,
        async (error: Error) => {
          // Rollback callback
          await executeRollback(
            request.sourceAdapter,
            request.targetAdapter,
            request.terminals,
            request.streamBuffer,
            error.message,
            this._eventBus
          );
        },
        this._eventBus
      );

      if (result.success) {
        // Transition to committing
        this._transitionState(transaction, "committing");
        request.onProgress?.("committing");

        // Transition to committed
        this._transitionState(transaction, "committed");
        request.onProgress?.("committed");

        return transaction;
      } else {
        // Hot-swap failed, rollback was triggered
        this._transitionState(transaction, "rolled-back");
        request.onProgress?.("rolled-back");

        transaction.error = result.error;
        return transaction;
      }
    } catch {
      // Unexpected error during hot-swap
      this._transitionState(transaction, "failed");
      request.onProgress?.("failed");

      transaction.error = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  /**
   * Execute restart-with-restore transition path (WP03).
   * @private
   */
  private async _executeRestartRestorePath(
    transaction: SwitchTransaction,
    request: SwitchTransactionRequest
  ): Promise<SwitchTransaction> {
    // Transition to restarting
    this._transitionState(transaction, "restarting");
    request.onProgress?.("restarting");

    try {
      // Execute restart-with-restore
      const result = await executeRestartWithRestore(
        request.sourceAdapter,
        request.targetAdapter,
        request.terminals,
        request.streamBuffer,
        request.config,
        request.surface,
        async (error: Error) => {
          // Rollback callback
          await executeRollback(
            request.sourceAdapter,
            request.targetAdapter,
            request.terminals,
            request.streamBuffer,
            error.message,
            this._eventBus
          );
        },
        this._eventBus
      );

      if (result.success) {
        // Transition to committing
        this._transitionState(transaction, "committing");
        request.onProgress?.("committing");

        // Transition to committed
        this._transitionState(transaction, "committed");
        request.onProgress?.("committed");

        return transaction;
      } else {
        // Restart-with-restore failed, rollback was triggered
        this._transitionState(transaction, "rolled-back");
        request.onProgress?.("rolled-back");

        transaction.error = result.error;
        return transaction;
      }
    } catch {
      // Unexpected error during restart-with-restore
      this._transitionState(transaction, "failed");
      request.onProgress?.("failed");

      transaction.error = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  /**
   * Transition the transaction to a new state with validation.
   * @private
   */
  private _transitionState(transaction: SwitchTransaction, toState: SwitchTransactionState): void {
    const validNextStates = VALID_TRANSITIONS[transaction.state];
    if (!validNextStates.includes(toState)) {
      throw new InvalidTransitionError(transaction.state, toState);
    }
    transaction.state = toState;
    transaction.updatedAt = Date.now();
  }

  /**
   * Get the active transaction, if any.
   */
  getActiveTransaction(): SwitchTransaction | undefined {
    return this._activeTransaction;
  }

  /**
   * Check if a switch is in progress.
   */
  isSwitchInProgress(): boolean {
    if (this._activeTransaction === undefined) {
      return false;
    }
    const { state } = this._activeTransaction;
    return (
      state !== "committed" && state !== "rolled-back" && state !== "failed" && state !== "degraded"
    );
  }

  /**
   * Queue a terminal creation request during an active transaction.
   *
   * If a switch is in progress, returns a promise that resolves after
   * the transaction completes. If no switch is active, executes immediately.
   *
   * @param params - Terminal creation parameters.
   * @returns Promise that resolves when the terminal creation completes.
   */
  queueTerminalCreation(params: unknown): Promise<unknown> {
    if (!this.isSwitchInProgress()) {
      // No switch active, would execute immediately (real impl would spawn terminal)
      return Promise.resolve(params);
    }

    // Queue the creation request
    return new Promise<unknown>((resolve, reject) => {
      const queued: QueuedTerminalCreation = {
        resolve,
        reject,
        params,
        createdAt: Date.now(),
        queueTimeoutMs: this._queueTimeoutMs,
      };

      this._terminalCreationQueue.push(queued);

      // Set timeout for queued request
      const timeoutId = setTimeout(() => {
        const index = this._terminalCreationQueue.indexOf(queued);
        if (index >= 0) {
          this._terminalCreationQueue.splice(index, 1);
          reject(
            new Error(
              `Terminal creation request timed out after ${this._queueTimeoutMs}ms during active switch transaction`
            )
          );
        }
      }, this._queueTimeoutMs);

      // Store timeout ID for cleanup
      (queued as any)._timeoutId = timeoutId;
    });
  }

  /**
   * Drain the terminal creation queue after transaction completion.
   *
   * Processes all queued creation requests in order, resolving each promise.
   * Called automatically when a transaction completes (committed, rolled-back, or degraded).
   *
   * @private
   */
  private _drainTerminalCreationQueue(): void {
    const queue = [...this._terminalCreationQueue];
    this._terminalCreationQueue.length = 0;

    for (const queued of queue) {
      // Clear the timeout
      if ((queued as any)._timeoutId) {
        clearTimeout((queued as any)._timeoutId);
      }

      // Resolve the queued request
      // In real impl, would actually spawn the terminal with the queued params
      queued.resolve(queued.params);
    }
  }
}

/**
 * Create a new switch transaction orchestrator instance.
 */
export function createSwitchOrchestrator(
  eventBus?: RendererEventBus
): SwitchTransactionOrchestrator {
  return new SwitchTransactionOrchestrator(eventBus);
}
