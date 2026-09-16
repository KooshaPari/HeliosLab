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

export type {
	RendererAdapter,
	RendererConfig,
	RendererState,
	RenderSurface,
} from "./adapter.js";

export type {
	CapabilityComparison,
	CapabilityDiff,
	RendererCapabilities,
} from "./capabilities.js";
export { compareCapabilities, queryCapabilities } from "./capabilities.js";
export type { HotSwapResult, TerminalContext } from "./hot_swap.js";
export {
	executeHotSwap,
	HotSwapCapabilityError,
	HotSwapError,
} from "./hot_swap.js";

export type { RegistrationMeta } from "./registry.js";
export {
	DuplicateRendererError,
	RendererNotFoundError,
	RendererRegistry,
} from "./registry.js";
export type { RestartRestoreResult, ZmxCheckpoint } from "./restart_restore.js";
export {
	executeRestartWithRestore,
	RestartRestoreError,
} from "./restart_restore.js";
export type { RollbackResult, RollbackTerminalStatus } from "./rollback.js";
export { executeRollback, RollbackError } from "./rollback.js";
export type { RendererEvent, TransitionRecord } from "./state_machine.js";
export {
	InvalidRendererTransitionError,
	RendererStateMachine,
	transition,
} from "./state_machine.js";
export type {
	BufferOverflowEvent,
	StreamBinding,
	StreamBindingEventBus,
} from "./stream_binding.js";
export { StreamBindingManager, SwitchBuffer } from "./stream_binding.js";
export type { SwitchContext } from "./switch.js";
export {
	SwitchSameRendererError,
	SwitchTimeoutError,
	switchRenderer,
} from "./switch.js";
export type {
	SwitchTransaction,
	SwitchTransactionRequest,
	SwitchTransactionState,
} from "./switch_transaction.js";
export {
	ConcurrentSwitchError,
	createSwitchOrchestrator,
	InvalidTransitionError,
	SwitchTransactionOrchestrator,
} from "./switch_transaction.js";

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
