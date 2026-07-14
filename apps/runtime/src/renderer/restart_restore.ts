/**
 * Restart-with-restore renderer switch fallback path.
 *
 * Used when hot-swap is unavailable. Takes zmx checkpoint snapshots, tears down
 * the source renderer, initializes the target, and restores state from the snapshot.
 *
 * @see FR-010-010, SC-010-003
 */

import type { RendererAdapter, RendererConfig, RenderSurface } from "./adapter.js";
import type { SwitchBuffer } from "./stream_binding.js";
import type { RendererEventBus } from "./index.js";
import type { TerminalContext } from "./hot_swap.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** zmx checkpoint snapshot for a single terminal. */
export interface ZmxCheckpoint {
  ptyId: string;
  scrollbackLines: Uint8Array[];
  cursorX: number;
  cursorY: number;
  dimensions: { cols: number; rows: number };
  environment: Record<string, string>;
  workingDirectory: string;
  timestamp: number;
}

/** Result of restart-with-restore execution. */
export interface RestartRestoreResult {
  success: boolean;
  phase: string;
  durationMs: number;
  checkpoints: ZmxCheckpoint[];
  error?: Error;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RestartRestoreError extends Error {
  constructor(
    public readonly phase: string,
    message: string
  ) {
    super(`Restart-with-restore failed during ${phase}: ${message}`);
    this.name = "RestartRestoreError";
  }
}

// ---------------------------------------------------------------------------
// Checkpoint and restore
// ---------------------------------------------------------------------------

/**
 * Take a zmx checkpoint snapshot for all active terminals.
 *
 * Captures scrollback, cursor position, environment, and working directory.
 * This data is used to restore terminal state after restart.
 *
 * @param terminals - Terminals to checkpoint.
 * @returns Array of checkpoint snapshots.
 */
function takeCheckpoints(terminals: Map<string, TerminalContext>): ZmxCheckpoint[] {
  const checkpoints: ZmxCheckpoint[] = [];

  for (const [ptyId, context] of terminals) {
    checkpoints.push({
      ptyId,
      scrollbackLines: context.scrollback,
      cursorX: context.cursorX,
      cursorY: context.cursorY,
      dimensions: { cols: 80, rows: 24 }, // Would be queried from real terminal
      environment: context.env,
      workingDirectory: context.cwd,
      timestamp: Date.now(),
    });
  }

  return checkpoints;
}

/**
 * Restore terminal state from a zmx checkpoint snapshot.
 *
 * In real implementation, would use zmx APIs to restore scrollback,
 * cursor position, and environment. Here we model the concept.
 *
 * @param checkpoint - The checkpoint to restore from.
 * @param adapter - The target renderer adapter.
 */
function restoreCheckpoint(checkpoint: ZmxCheckpoint, adapter: RendererAdapter): void {
  // In real implementation:
  // - Use zmx API to restore scrollback lines
  // - Restore cursor position via escape sequences
  // - Set environment variables
  // - Change working directory
  // For now, just bind a placeholder stream
  adapter.bindStream(checkpoint.ptyId, new ReadableStream());
}

// ---------------------------------------------------------------------------
// Restart-with-restore execution
// ---------------------------------------------------------------------------

/**
 * Execute restart-with-restore transition path.
 *
 * Implements a 4-phase process:
 * 1. Checkpoint: capture current terminal state via zmx
 * 2. Teardown: stop source renderer while buffering output
 * 3. Start and restore: init target, restore from checkpoint, replay buffer
 * 4. Commit: transition to committed state
 *
 * @param sourceAdapter - The currently active renderer.
 * @param targetAdapter - The renderer to switch to.
 * @param terminals - Terminal contexts to checkpoint and restore.
 * @param streamBuffer - PTY buffer for capturing output during switch.
 * @param config - Renderer configuration for target initialization.
 * @param surface - Render surface for target initialization.
 * @param onRollback - Callback invoked on failure to trigger rollback.
 * @param eventBus - Optional event bus for progress notifications.
 * @returns Restart-restore result with checkpoint data and status.
 */
export async function executeRestartWithRestore(
  sourceAdapter: RendererAdapter,
  targetAdapter: RendererAdapter,
  terminals: Map<string, TerminalContext>,
  streamBuffer: SwitchBuffer,
  config: RendererConfig,
  surface: RenderSurface,
  onRollback: (error: Error) => Promise<void>,
  _eventBus?: RendererEventBus
): Promise<RestartRestoreResult> {
  const _startTime = Date.now();
  let currentPhase = "checkpoint";
  let checkpoints: ZmxCheckpoint[] = [];

  try {
    // ===== Phase 1: Checkpoint =====
    if (terminals.size === 0) {
      throw new RestartRestoreError(currentPhase, "no active terminals");
    }

    checkpoints = takeCheckpoints(terminals);
    streamBuffer.startBuffering();

    // ===== Phase 2: Teardown =====
    currentPhase = "teardown";

    try {
      await sourceAdapter.stop();
    } catch (e: unknown) {
      throw new RestartRestoreError(
        currentPhase,
        `source stop failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    // ===== Phase 3: Start and restore =====
    currentPhase = "start-and-restore";

    // Initialize target renderer
    try {
      await targetAdapter.init(config);
      await targetAdapter.start(surface);
    } catch (e: unknown) {
      throw new RestartRestoreError(
        currentPhase,
        `target init failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    // Restore terminal state from checkpoints
    try {
      for (const checkpoint of checkpoints) {
        restoreCheckpoint(checkpoint, targetAdapter);
      }
    } catch (e: unknown) {
      throw new RestartRestoreError(
        currentPhase,
        `restore failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    // Replay PTY buffers
    try {
      streamBuffer.stopBuffering(targetAdapter);
    } catch (e: unknown) {
      throw new RestartRestoreError(
        currentPhase,
        `replay failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    // ===== Phase 4: Commit =====
    currentPhase = "commit";

    return {
      success: true,
      phase: "committed",
      durationMs: Date.now() - startTime,
      checkpoints,
    };
  } catch {
    const restartError =
      error instanceof RestartRestoreError
        ? error
        : new RestartRestoreError(currentPhase, String(error));

    // Trigger rollback
    try {
      await onRollback(restartError);
    } catch {
      // Rollback error will be handled separately
    }

    return {
      success: false,
      phase: currentPhase,
      durationMs: Date.now() - startTime,
      checkpoints,
      error: restartError,
    };
  }
}
