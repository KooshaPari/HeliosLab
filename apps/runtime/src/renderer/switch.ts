/**
 * Transactional renderer switching with automatic rollback.
 *
 * Implements the full switch protocol: unbind streams -> stop old ->
 * start new -> rebind streams. On failure the old renderer is restored.
 */

import type { RendererAdapter, RenderSurface, RendererConfig } from "./adapter.js";
import type { RendererRegistry } from "./registry.js";
import type { RendererStateMachine } from "./state_machine.js";
import type { RendererEventBus } from "./index.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SwitchTimeoutError extends Error {
  constructor(durationMs: number) {
    super(`Renderer switch timed out after ${durationMs}ms`);
    this.name = "SwitchTimeoutError";
  }
}

export class SwitchSameRendererError extends Error {
  constructor(id: string) {
    super(`Cannot switch renderer to itself: "${id}"`);
    this.name = "SwitchSameRendererError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context required to perform a renderer switch. */
export interface SwitchContext {
  registry: RendererRegistry;
  stateMachine: RendererStateMachine;
  surface: RenderSurface;
  config: RendererConfig;
  /** Map of ptyId -> stream currently bound. */
  boundStreams: Map<string, ReadableStream<Uint8Array>>;
  /** Optional event bus for publishing lifecycle events. */
  eventBus?: RendererEventBus | undefined;
  /** Switch timeout in ms (default 3000). */
  timeoutMs?: number | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SwitchTimeoutError(ms));
    }, ms);
    promise.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function rebindStreams(
  adapter: RendererAdapter,
  streams: Map<string, ReadableStream<Uint8Array>>
): void {
  for (const [ptyId, stream] of streams) {
    adapter.bindStream(ptyId, stream);
  }
}

function unbindStreams(
  adapter: RendererAdapter,
  streams: Map<string, ReadableStream<Uint8Array>>
): void {
  for (const [ptyId] of streams) {
    adapter.unbindStream(ptyId);
  }
}

// ---------------------------------------------------------------------------
// Switch implementation
// ---------------------------------------------------------------------------

/**
 * Atomically switch from one renderer to another.
 *
 * On success the new renderer is active and all PTY streams are rebound.
 * On failure the old renderer is restored (rolled back). If rollback also
 * fails the state machine transitions to `errored`.
 *
 * Total switch budget: 3 seconds by default (NFR-010-001).
 *
 * @param fromId - ID of the currently active renderer.
 * @param toId   - ID of the renderer to switch to.
 * @param ctx    - Switch context containing registry, state machine, etc.
 * @throws {SwitchSameRendererError} when `fromId === toId`.
 */
export async function switchRenderer(
  fromId: string,
  toId: string,
  ctx: SwitchContext
): Promise<void> {
  if (fromId === toId) {
    throw new SwitchSameRendererError(fromId);
  }

  const { registry, stateMachine, surface, config, boundStreams, eventBus } = ctx;
  const timeoutMs = ctx.timeoutMs ?? 3_000;
  const correlationId = crypto.randomUUID();
  const switchStart = Date.now();

  const fromAdapter = registry.get(fromId);
  const toAdapter = registry.get(toId);
  if (fromAdapter === undefined) {
    throw new Error(`Source renderer "${fromId}" is not registered`);
  }
  if (toAdapter === undefined) {
    throw new Error(`Target renderer "${toId}" is not registered`);
  }

  // Transition to switching
  stateMachine.transition("switch_request");

  try {
    await withTimeout(
      (async () => {
        // 1. Unbind streams from current renderer
        unbindStreams(fromAdapter, boundStreams);

        // 2. Stop the current renderer
        await fromAdapter.stop();

        // 3. Init + start the new renderer
        await toAdapter.init(config);
        await toAdapter.start(surface);

        // 4. Rebind streams to new renderer
        rebindStreams(toAdapter, boundStreams);

        // 5. Mark new renderer as active
        registry.setActive(toId);
      })(),
      timeoutMs
    );

    // Success
    stateMachine.transition("switch_success");

    eventBus?.publish({
      type: "renderer.switched",
      rendererId: toId,
      fromState: "running",
      toState: "running",
      timestamp: Date.now(),
      correlationId,
      fromRenderer: fromId,
      toRenderer: toId,
      switchDurationMs: Date.now() - switchStart,
    });
  } catch (switchError: unknown) {
    // Attempt rollback
    try {
      // Try to stop the new renderer if it started
      try {
        await toAdapter.stop();
      } catch {
        // Best effort
      }

      // Restart old renderer
      await fromAdapter.init(config);
      await fromAdapter.start(surface);

      // Rebind to old renderer
      rebindStreams(fromAdapter, boundStreams);

      // Restore active marker
      registry.setActive(fromId);

      // Rolled back successfully
      stateMachine.transition("switch_rollback");

      eventBus?.publish({
        type: "renderer.switch_failed",
        rendererId: fromId,
        fromState: "switching",
        toState: "running",
        timestamp: Date.now(),
        correlationId,
        fromRenderer: fromId,
        toRenderer: toId,
        switchDurationMs: Date.now() - switchStart,
        error: switchError instanceof Error ? switchError : new Error(String(switchError)),
      });
    } catch (rollbackError: unknown) {
      // Double failure — errored state
      stateMachine.transition("switch_failure");

      eventBus?.publish({
        type: "renderer.errored",
        rendererId: fromId,
        fromState: "switching",
        toState: "errored",
        timestamp: Date.now(),
        correlationId,
        error: rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)),
      });

      throw rollbackError;
    }

    throw switchError;
  }
}
