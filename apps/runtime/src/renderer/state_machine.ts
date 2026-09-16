/**
 * Renderer lifecycle state machine.
 *
 * Governs all valid state transitions for a renderer adapter and rejects
 * invalid ones with a descriptive error.
 */

import type { RendererState } from "./adapter.js";

// Re-export for convenience
export type { RendererState };

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Events that trigger state transitions in the renderer lifecycle.
 */
export type RendererEvent =
	| "init"
	| "init_success"
	| "init_failure"
	| "switch_request"
	| "stop_request"
	| "crash"
	| "switch_success"
	| "switch_rollback"
	| "switch_failure"
	| "stop_complete"
	| "recovery_attempt"
	| "give_up";

// ---------------------------------------------------------------------------
// Transition record
// ---------------------------------------------------------------------------

/** Diagnostic record of a single state transition. */
export interface TransitionRecord {
	from: RendererState;
	to: RendererState;
	event: RendererEvent;
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Thrown when a requested state transition is not valid.
 */
export class InvalidRendererTransitionError extends Error {
	constructor(
		public readonly currentState: RendererState,
		public readonly event: RendererEvent,
	) {
		super(
			`Invalid renderer transition: cannot apply event "${event}" in state "${currentState}"`,
		);
		this.name = "InvalidRendererTransitionError";
	}
}

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

type TransitionTable = Readonly<
	Record<RendererState, Partial<Record<RendererEvent, RendererState>>>
>;

const TRANSITIONS: TransitionTable = {
	uninitialized: {
		init: "initializing",
	},
	initializing: {
		init_success: "running",
		init_failure: "errored",
	},
	running: {
		switch_request: "switching",
		stop_request: "stopping",
		crash: "errored",
	},
	switching: {
		switch_success: "running",
		switch_rollback: "running",
		switch_failure: "errored",
	},
	stopping: {
		stop_complete: "stopped",
	},
	stopped: {},
	errored: {
		recovery_attempt: "initializing",
		give_up: "stopped",
	},
};

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const MAX_HISTORY = 10;

/**
 * Deterministic state machine for renderer lifecycle management.
 *
 * Tracks the current state, validates transitions, and maintains a
 * rolling history of the last {@link MAX_HISTORY} transitions.
 */
export class RendererStateMachine {
	private _state: RendererState = "uninitialized";
	private readonly _history: TransitionRecord[] = [];

	/** The current renderer state. */
	get state(): RendererState {
		return this._state;
	}

	/** Rolling history of the last transitions (max 10). */
	get history(): readonly TransitionRecord[] {
		return this._history;
	}

	/**
	 * Attempt a state transition triggered by `event`.
	 *
	 * @param event - The triggering event.
	 * @returns The new {@link RendererState} after the transition.
	 * @throws {InvalidRendererTransitionError} if the transition is not allowed.
	 */
	transition(event: RendererEvent): RendererState {
		const nextState = TRANSITIONS[this._state][event] as
			| RendererState
			| undefined;
		if (nextState === undefined) {
			throw new InvalidRendererTransitionError(this._state, event);
		}

		const record: TransitionRecord = {
			from: this._state,
			to: nextState,
			event,
			timestamp: Date.now(),
		};
		this._history.push(record);
		if (this._history.length > MAX_HISTORY) {
			this._history.shift();
		}

		this._state = nextState;
		return nextState;
	}
}

/**
 * Pure transition function (stateless).
 *
 * @param current - Current state.
 * @param event   - Triggering event.
 * @returns The resulting state.
 * @throws {InvalidRendererTransitionError} if invalid.
 */
export function transition(
	current: RendererState,
	event: RendererEvent,
): RendererState {
	const nextState = TRANSITIONS[current][event] as RendererState | undefined;
	if (nextState === undefined) {
		throw new InvalidRendererTransitionError(current, event);
	}
	return nextState;
}
