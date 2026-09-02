/**
 * Renderer module barrel export and lifecycle event definitions.
 *
 * All renderer lifecycle events are defined here and published to the
 * local event bus. Events are fire-and-forget: bus failures never block
 * renderer operations.
 */

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { RendererAdapter, RendererConfig, RenderSurface, RendererState } from "./adapter.js";

export type { RendererCapabilities, CapabilityDiff, CapabilityComparison } from "./capabilities.js";
export { queryCapabilities, compareCapabilities } from "./capabilities.js";

export type { RendererEvent, TransitionRecord } from "./state_machine.js";
export {
  RendererStateMachine,
  InvalidRendererTransitionError,
  transition,
} from "./state_machine.js";

export type { RegistrationMeta } from "./registry.js";
export { RendererRegistry, DuplicateRendererError, RendererNotFoundError } from "./registry.js";

export type { SwitchContext } from "./switch.js";
export { switchRenderer, SwitchTimeoutError, SwitchSameRendererError } from "./switch.js";

export type {
  StreamBinding,
  BufferOverflowEvent,
  StreamBindingEventBus,
} from "./stream_binding.js";
export { StreamBindingManager, SwitchBuffer } from "./stream_binding.js";

export type { HotSwapResult, TerminalContext } from "./hot_swap.js";
export { executeHotSwap, HotSwapError, HotSwapCapabilityError } from "./hot_swap.js";

export type { RollbackResult, RollbackTerminalStatus } from "./rollback.js";
export { executeRollback, RollbackError } from "./rollback.js";

export type {
  SwitchTransaction,
  SwitchTransactionRequest,
  SwitchTransactionState,
} from "./switch_transaction.js";
export {
  SwitchTransactionOrchestrator,
  createSwitchOrchestrator,
  ConcurrentSwitchError,
  InvalidTransitionError,
} from "./switch_transaction.js";

export type { ZmxCheckpoint, RestartRestoreResult } from "./restart_restore.js";
export { executeRestartWithRestore, RestartRestoreError } from "./restart_restore.js";

// ---------------------------------------------------------------------------
// Lifecycle event types
// ---------------------------------------------------------------------------

/** Base fields present on every renderer lifecycle event. */
export interface RendererLifecycleEventBase {
  rendererId: string;
  fromState: string;
  toState: string;
  timestamp: number;
  correlationId: string;
}

/** Emitted when a renderer has been initialised. */
export interface RendererInitializedEvent extends RendererLifecycleEventBase {
  type: "renderer.initialized";
}

/** Emitted when a renderer has started rendering. */
export interface RendererStartedEvent extends RendererLifecycleEventBase {
  type: "renderer.started";
}

/** Emitted after a successful renderer switch. */
export interface RendererSwitchedEvent extends RendererLifecycleEventBase {
  type: "renderer.switched";
  fromRenderer: string;
  toRenderer: string;
  switchDurationMs: number;
}

/** Emitted when a renderer switch fails but rollback succeeds. */
export interface RendererSwitchFailedEvent extends RendererLifecycleEventBase {
  type: "renderer.switch_failed";
  fromRenderer: string;
  toRenderer: string;
  switchDurationMs: number;
  error: Error;
}

/** Emitted when a renderer has stopped. */
export interface RendererStoppedEvent extends RendererLifecycleEventBase {
  type: "renderer.stopped";
}

/** Emitted when a renderer enters the errored state. */
export interface RendererErroredEvent extends RendererLifecycleEventBase {
  type: "renderer.errored";
  error: Error;
}

/** Emitted when a renderer crashes unexpectedly. */
export interface RendererCrashedEvent extends RendererLifecycleEventBase {
  type: "renderer.crashed";
  error: Error;
}

/** Union of all renderer lifecycle events. */
export type RendererLifecycleEvent =
  | RendererInitializedEvent
  | RendererStartedEvent
  | RendererSwitchedEvent
  | RendererSwitchFailedEvent
  | RendererStoppedEvent
  | RendererErroredEvent
  | RendererCrashedEvent;

// ---------------------------------------------------------------------------
// Event bus interface (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Minimal event bus interface for renderer lifecycle events.
 *
 * Implementations should catch and log internal errors. A bus failure must
 * never block or fail a renderer operation.
 */
export interface RendererEventBus {
  /**
   * Publish a lifecycle event. Fire-and-forget semantics.
   *
   * @param event - The event to publish.
   */
  publish(event: RendererLifecycleEvent): void;
}
