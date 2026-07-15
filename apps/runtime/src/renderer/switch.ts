/**
 * Transactional renderer switching with automatic rollback.
 *
 * Implements the full switch protocol: unbind streams -> stop old ->
 * start new -> rebind streams. On failure the old renderer is restored.
 */

import type { RendererAdapter, RenderSurface, RendererConfig } from "./adapter.js";
import type { RendererRegistry } from "./registry.js";
import type { RendererStateMachine } from "./state_machine.js";
import type { RendererEventBus, RendererLifecycleEvent } from "./index.js";
import type { SwitchBuffer } from "./stream_binding.js";

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
  /** Captures PTY output produced while the renderer transaction is in flight. */
  switchBuffer?: SwitchBuffer | undefined;
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

function prependBufferedData(
  buffered: Uint8Array,
  stream: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let prefixPending = buffered.byteLength > 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (prefixPending) {
        prefixPending = false;
        controller.enqueue(buffered);
        return;
      }
      const result = await reader.read();
      if (result.done) {
        controller.close();
      } else {
        controller.enqueue(result.value);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function rebindStreams(
  adapter: RendererAdapter,
  streams: Map<string, ReadableStream<Uint8Array>>,
  bufferedData: Map<string, Uint8Array> = new Map()
): void {
  for (const [ptyId, stream] of streams) {
    const buffered = bufferedData.get(ptyId);
    adapter.bindStream(
      ptyId,
      buffered !== undefined && buffered.byteLength > 0
        ? prependBufferedData(buffered, stream)
        : stream
    );
    bufferedData.delete(ptyId);
  }
  for (const [ptyId, buffered] of bufferedData) {
    adapter.bindStream(
      ptyId,
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(buffered);
          controller.close();
        },
      })
    );
  }
}

function publish(eventBus: RendererEventBus | undefined, event: RendererLifecycleEvent): void {
  try {
    eventBus?.publish(event);
  } catch {
    // Lifecycle publication is fire-and-forget and cannot fail a switch.
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

  const { registry, stateMachine, surface, config, boundStreams, eventBus, switchBuffer } = ctx;
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
  switchBuffer?.startBuffering();

  try {
    await withTimeout(
      (async () => {
        // 1. Unbind streams from current renderer
        unbindStreams(fromAdapter, boundStreams);

        // 2. Stop the current renderer
        await fromAdapter.stop();
        publish(eventBus, {
          type: "renderer.stopped",
          rendererId: fromId,
          fromState: "running",
          toState: "stopped",
          timestamp: Date.now(),
          correlationId,
        });

        // 3. Switch the target adapter through its lifecycle contract.
        await toAdapter.switch(config, surface);
        publish(eventBus, {
          type: "renderer.initialized",
          rendererId: toId,
          fromState: "uninitialized",
          toState: "initializing",
          timestamp: Date.now(),
          correlationId,
        });
        publish(eventBus, {
          type: "renderer.started",
          rendererId: toId,
          fromState: "initializing",
          toState: "running",
          timestamp: Date.now(),
          correlationId,
        });

        // 4. Prefix buffered output to the live streams and bind once.
        const bufferedData = switchBuffer?.drainBufferedData() ?? new Map();
        rebindStreams(toAdapter, boundStreams, bufferedData);

        // 5. Mark new renderer as active
        registry.setActive(toId);
      })(),
      timeoutMs
    );

    // Success
    stateMachine.transition("switch_success");

    publish(eventBus, {
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

      // Restart old renderer through the same lifecycle contract.
      await fromAdapter.switch(config, surface);
      publish(eventBus, {
        type: "renderer.initialized",
        rendererId: fromId,
        fromState: "stopped",
        toState: "initializing",
        timestamp: Date.now(),
        correlationId,
      });
      publish(eventBus, {
        type: "renderer.started",
        rendererId: fromId,
        fromState: "initializing",
        toState: "running",
        timestamp: Date.now(),
        correlationId,
      });

      // Rebind to old renderer, preserving all bytes accepted before failure.
      const bufferedData = switchBuffer?.drainBufferedData(true) ?? new Map();
      rebindStreams(fromAdapter, boundStreams, bufferedData);

      // Restore active marker
      registry.setActive(fromId);

      // Rolled back successfully
      stateMachine.transition("switch_rollback");

      publish(eventBus, {
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

      publish(eventBus, {
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
