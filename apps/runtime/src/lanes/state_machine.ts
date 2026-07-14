// T001 - Lane state machine with validated transitions

export type LaneState =
  | "new"
  | "provisioning"
  | "ready"
  | "running"
  | "active"
  | "recovering"
  | "blocked"
  | "shared"
  | "cleaning"
  | "closed";

export type LaneEvent =
  | "create"
  | "provision_complete"
  | "provision_failed"
  | "start_running"
  | "command_complete"
  | "block"
  | "unblock"
  | "share"
  | "unshare"
  | "request_cleanup"
  | "cleanup_complete";

export class InvalidLaneTransitionError extends Error {
  constructor(
    public readonly laneId: string,
    public readonly currentState: LaneState,
    public readonly attemptedEvent: LaneEvent
  ) {
    super(`Invalid lane transition: lane=${laneId} state=${currentState} event=${attemptedEvent}`);
    this.name = "InvalidLaneTransitionError";
  }
}

type TransitionEntry = {
  fromState: LaneState;
  event: LaneEvent;
  toState: LaneState;
  timestamp: string;
};

// Transition table: Map<currentState, Map<event, nextState>>
const TRANSITION_TABLE: ReadonlyMap<LaneState, ReadonlyMap<LaneEvent, LaneState>> = new Map<
  LaneState,
  Map<LaneEvent, LaneState>
>([
  ["new", new Map([["create", "provisioning"]])],
  [
    "provisioning",
    new Map([
      ["provision_complete", "ready"],
      ["provision_failed", "closed"],
    ]),
  ],
  [
    "ready",
    new Map([
      ["start_running", "running"],
      ["share", "shared"],
      ["request_cleanup", "cleaning"],
    ]),
  ],
  [
    "running",
    new Map([
      ["command_complete", "ready"],
      ["block", "blocked"],
      ["request_cleanup", "cleaning"],
    ]),
  ],
  [
    "blocked",
    new Map([
      ["unblock", "running"],
      ["request_cleanup", "cleaning"],
    ]),
  ],
  [
    "shared",
    new Map([
      ["unshare", "ready"],
      ["request_cleanup", "cleaning"],
    ]),
  ],
  [
    "cleaning",
    new Map([
      ["cleanup_complete", "closed"],
      // Idempotent: duplicate cleanup request on cleaning lane is a no-op
      ["request_cleanup", "cleaning"],
    ]),
  ],
  // closed is terminal - no outgoing transitions
  ["closed", new Map()],
]);

const MAX_HISTORY = 20;

export function transition(currentState: LaneState, event: LaneEvent, laneId: string): LaneState {
  const stateTransitions = TRANSITION_TABLE.get(currentState);
  if (!stateTransitions) {
    throw new InvalidLaneTransitionError(laneId, currentState, event);
  }
  const nextState = stateTransitions.get(event);
  if (nextState === undefined) {
    throw new InvalidLaneTransitionError(laneId, currentState, event);
  }
  return nextState;
}

// Per-lane async mutex using promise chain pattern
const laneLocks = new Map<string, Promise<void>>();

export async function withLaneLock<T>(laneId: string, fn: () => Promise<T>): Promise<T> {
  const prev = laneLocks.get(laneId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>(r => {
    resolve = r;
  });
  laneLocks.set(laneId, next);

  await prev;
  try {
    return await fn();
  } finally {
    resolve!();
    // Clean up if this is the last in chain
    if (laneLocks.get(laneId) === next) {
      laneLocks.delete(laneId);
    }
  }
}

// Per-lane transition history
const transitionHistories = new Map<string, TransitionEntry[]>();

export function recordTransition(
  laneId: string,
  fromState: LaneState,
  event: LaneEvent,
  toState: LaneState
): void {
  let history = transitionHistories.get(laneId);
  if (!history) {
    history = [];
    transitionHistories.set(laneId, history);
  }
  history.push({
    fromState,
    event,
    toState,
    timestamp: new Date().toISOString(),
  });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

export function getTransitionHistory(laneId: string): readonly TransitionEntry[] {
  return transitionHistories.get(laneId) ?? [];
}

export function clearTransitionHistory(laneId: string): void {
  transitionHistories.delete(laneId);
}
