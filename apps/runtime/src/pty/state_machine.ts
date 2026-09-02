/**
 * PTY State Machine — governs all PTY lifecycle transitions.
 *
 * The state machine is pure: no side effects. Callers are responsible
 * for acting on state changes (spawning processes, cleaning up, etc.).
 *
 * @module
 */

/** All possible PTY states. */
export type PtyState = "idle" | "spawning" | "active" | "throttled" | "errored" | "stopped";

/** Events that trigger PTY state transitions. */
export type PtyEvent =
  | "spawn_requested"
  | "spawn_succeeded"
  | "spawn_failed"
  | "idle_timeout"
  | "unexpected_exit"
  | "graceful_terminate"
  | "output_resume"
  | "terminate"
  | "cleanup";

/**
 * Error thrown when an invalid state transition is attempted.
 */
export class InvalidTransitionError extends Error {
  public readonly ptyId: string;
  public readonly currentState: PtyState;
  public readonly event: PtyEvent;

  constructor(ptyId: string, currentState: PtyState, event: PtyEvent) {
    super(
      `Invalid PTY transition: cannot apply event '${event}' in state '${currentState}' (ptyId=${ptyId})`
    );
    this.name = "InvalidTransitionError";
    this.ptyId = ptyId;
    this.currentState = currentState;
    this.event = event;
  }
}

/**
 * Transition table: maps `(currentState, event)` pairs to the next state.
 * Any pair not in this table is an invalid transition.
 */
const TRANSITION_TABLE: ReadonlyMap<PtyState, ReadonlyMap<PtyEvent, PtyState>> = new Map<
  PtyState,
  ReadonlyMap<PtyEvent, PtyState>
>([
  ["idle", new Map<PtyEvent, PtyState>([["spawn_requested", "spawning"]])],
  [
    "spawning",
    new Map<PtyEvent, PtyState>([
      ["spawn_succeeded", "active"],
      ["spawn_failed", "errored"],
    ]),
  ],
  [
    "active",
    new Map<PtyEvent, PtyState>([
      ["idle_timeout", "throttled"],
      ["unexpected_exit", "errored"],
      ["graceful_terminate", "stopped"],
    ]),
  ],
  [
    "throttled",
    new Map<PtyEvent, PtyState>([
      ["output_resume", "active"],
      ["terminate", "stopped"],
    ]),
  ],
  ["errored", new Map<PtyEvent, PtyState>([["cleanup", "stopped"]])],
  // "stopped" is terminal — no outgoing transitions.
  ["stopped", new Map<PtyEvent, PtyState>()],
]);

/**
 * Compute the next state for a PTY given the current state and an event.
 *
 * @param currentState - The current {@link PtyState}.
 * @param event - The {@link PtyEvent} to apply.
 * @param ptyId - The PTY ID, used for diagnostic context in errors.
 * @returns The next {@link PtyState}.
 * @throws {@link InvalidTransitionError} if the transition is not valid.
 */
export function transition(currentState: PtyState, event: PtyEvent, ptyId: string): PtyState {
  const stateTransitions = TRANSITION_TABLE.get(currentState);
  const nextState = stateTransitions?.get(event);

  if (nextState === undefined) {
    throw new InvalidTransitionError(ptyId, currentState, event);
  }

  return nextState;
}

/** A recorded transition for debugging purposes. */
export interface TransitionRecord {
  readonly from: PtyState;
  readonly to: PtyState;
  readonly event: PtyEvent;
  readonly timestamp: number;
}

/**
 * Tracks the lifecycle of a single PTY instance, including current state
 * and a bounded history of recent transitions.
 */
export class PtyLifecycle {
  private _state: PtyState;
  private readonly _history: TransitionRecord[] = [];
  private static readonly MAX_HISTORY = 10;

  /** The PTY ID this lifecycle tracks. */
  public readonly ptyId: string;

  constructor(ptyId: string, initialState: PtyState = "idle") {
    this.ptyId = ptyId;
    this._state = initialState;
  }

  /** Current state of the PTY. */
  get state(): PtyState {
    return this._state;
  }

  /** The last N transition records (most recent last). */
  get history(): readonly TransitionRecord[] {
    return this._history;
  }

  /**
   * Apply an event, advancing the state machine.
   *
   * @param event - The event to apply.
   * @returns The new {@link PtyState}.
   * @throws {@link InvalidTransitionError} on invalid transitions.
   */
  apply(event: PtyEvent): PtyState {
    const prev = this._state;
    const next = transition(prev, event, this.ptyId);

    this._history.push({
      from: prev,
      to: next,
      event,
      timestamp: Date.now(),
    });

    // Keep history bounded.
    if (this._history.length > PtyLifecycle.MAX_HISTORY) {
      this._history.shift();
    }

    this._state = next;
    return next;
  }
}
