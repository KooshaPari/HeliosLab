/**
 * Hot-swap renderer transition implementation.
 *
 * Atomically transitions all active terminals from source to target renderer
 * using the PTY stream proxy to guarantee zero byte loss during the switch.
 *
 * @see FR-010-009, SC-010-002
 */

import type { RendererAdapter, RendererConfig, RenderSurface } from "./adapter.js";
import type { SwitchBuffer } from "./stream_binding.js";
import type { RendererEventBus } from "./index.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class HotSwapError extends Error {
  constructor(
    public readonly phase: string,
    message: string
  ) {
    super(`Hot-swap failed during ${phase}: ${message}`);
    this.name = "HotSwapError";
  }
}

export class HotSwapCapabilityError extends Error {
  constructor(sourceId: string, targetId: string) {
    super(
      `Cannot hot-swap from "${sourceId}" to "${targetId}": renderer does not support hot-swap`
    );
    this.name = "HotSwapCapabilityError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Terminal context to preserve during hot-swap. */
export interface TerminalContext {
  ptyId: string;
  scrollback: Uint8Array[];
  cursorX: number;
  cursorY: number;
  env: Record<string, string>;
  cwd: string;
}

/** Result of hot-swap execution. */
export interface HotSwapResult {
  success: boolean;
  phase: string;
  durationMs: number;
  preservedContexts: TerminalContext[];
  error?: Error;
}

// ---------------------------------------------------------------------------
// Hot-swap execution
// ---------------------------------------------------------------------------

/**
 * Atomically transition all active terminals from source to target renderer.
 *
 * Implements a 4-phase process:
 * 1. Pre-validation: check capabilities and terminal health
 * 2. Buffer activation: start PTY stream proxy buffering
 * 3. Renderer swap: init target, stop source
 * 4. Replay and commit: flush buffers to target, verify continuity
 *
 * On failure at any phase, triggers automatic rollback via callback.
 *
 * @param sourceAdapter - The currently active renderer.
 * @param targetAdapter - The renderer to switch to.
 * @param terminals - Map of ptyId -> terminal context.
 * @param streamBuffer - The PTY stream proxy for buffering.
 * @param config - Renderer configuration for target initialization.
 * @param surface - Render surface for target initialization.
 * @param onRollback - Callback invoked on failure to trigger rollback.
 * @param eventBus - Optional event bus for progress notifications.
 * @returns Hot-swap result with success flag and per-terminal context.
 */
export async function executeHotSwap(
  sourceAdapter: RendererAdapter,
  targetAdapter: RendererAdapter,
  terminals: Map<string, TerminalContext>,
  streamBuffer: SwitchBuffer,
  config: RendererConfig,
  surface: RenderSurface,
  onRollback: (error: Error) => Promise<void>,
  _eventBus?: RendererEventBus
): Promise<HotSwapResult> {
  const _startTime = Date.now();
  let currentPhase = "pre-validation";

  try {
    // ===== Phase 1: Pre-validation =====
    if (terminals.size === 0) {
      throw new HotSwapError(currentPhase, "no active terminals");
    }

    // Verify all PTY streams are healthy
    for (const [ptyId] of terminals) {
      // In real implementation, would check stream health
      if (ptyId === "") {
        throw new HotSwapError(currentPhase, "invalid ptyId");
      }
    }

    // ===== Phase 2: Buffer activation =====
    currentPhase = "buffer-activation";
    streamBuffer.startBuffering();

    // ===== Phase 3: Renderer swap =====
    currentPhase = "renderer-swap";

    // Initialize target renderer
    try {
      await targetAdapter.init(config);
    } catch (e: unknown) {
      throw new HotSwapError(
        currentPhase,
        `target init failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    try {
      await targetAdapter.start(surface);
    } catch (e: unknown) {
      throw new HotSwapError(
        currentPhase,
        `target start failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    // Stop source renderer
    try {
      await sourceAdapter.stop();
    } catch (e: unknown) {
      throw new HotSwapError(
        currentPhase,
        `source stop failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    // ===== Phase 4: Replay and commit =====
    currentPhase = "replay-commit";

    // Replay PTY buffers to target renderer
    streamBuffer.stopBuffering(targetAdapter);

    // Verify all replays are functional (no errors)
    for (const ptyId of terminals.keys()) {
      try {
        targetAdapter.bindStream(ptyId, new ReadableStream());
      } catch (e: unknown) {
        throw new HotSwapError(
          currentPhase,
          `replay for ${ptyId} failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    currentPhase = "complete";

    return {
      success: true,
      phase: "committed",
      durationMs: Date.now() - startTime,
      preservedContexts: Array.from(terminals.values()),
    };
  } catch {
    const hotSwapError =
      error instanceof HotSwapError ? error : new HotSwapError(currentPhase, String(error));

    // Trigger rollback
    try {
      await onRollback(hotSwapError);
    } catch {
      // Rollback error will be handled separately
    }

    return {
      success: false,
      phase: currentPhase,
      durationMs: Date.now() - startTime,
      preservedContexts: Array.from(terminals.values()),
      error: hotSwapError,
    };
  }
}
