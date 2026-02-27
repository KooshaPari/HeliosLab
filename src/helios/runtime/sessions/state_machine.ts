export type LaneState = "new" | "provisioning" | "ready" | "running" | "blocked" | "shared" | "failed" | "cleaning" | "closed";
export type SessionState = "detached" | "attaching" | "attached" | "restoring" | "terminated";
export type TerminalState = "idle" | "spawning" | "active" | "throttled" | "errored" | "stopped";

export type RuntimeState = {
  lane: LaneState;
  session: SessionState;
  terminal: TerminalState;
};

export type RuntimeEvent =
  | "lane.create.requested"
  | "lane.create.succeeded"
  | "lane.create.failed"
  | "lane.run.started"
  | "lane.blocked"
  | "lane.share.started"
  | "lane.share.stopped"
  | "lane.cleanup.started"
  | "lane.cleanup.completed"
  | "session.attach.requested"
  | "session.attach.succeeded"
  | "session.restore.started"
  | "session.restore.completed"
  | "session.terminated"
  | "terminal.spawn.requested"
  | "terminal.spawn.succeeded"
  | "terminal.throttled"
  | "terminal.error"
  | "terminal.stopped";

export const INITIAL_RUNTIME_STATE: RuntimeState = {
  lane: "new",
  session: "detached",
  terminal: "idle"
};

export function transition(state: RuntimeState, event: RuntimeEvent): RuntimeState {
  switch (event) {
    case "lane.create.requested":
      return { ...state, lane: "provisioning" };
    case "lane.create.succeeded":
      return { ...state, lane: "ready" };
    case "lane.create.failed":
      return { ...state, lane: "failed" };
    case "lane.run.started":
      return { ...state, lane: "running" };
    case "lane.blocked":
      return { ...state, lane: "blocked" };
    case "lane.share.started":
      return { ...state, lane: "shared" };
    case "lane.share.stopped":
      return { ...state, lane: "running" };
    case "lane.cleanup.started":
      return { ...state, lane: "cleaning" };
    case "lane.cleanup.completed":
      return { ...state, lane: "closed" };
    case "session.attach.requested":
      return { ...state, session: "attaching" };
    case "session.attach.succeeded":
      return { ...state, session: "attached" };
    case "session.restore.started":
      return { ...state, session: "restoring" };
    case "session.restore.completed":
      return { ...state, session: "attached" };
    case "session.terminated":
      return { ...state, session: "terminated" };
    case "terminal.spawn.requested":
      return { ...state, terminal: "spawning" };
    case "terminal.spawn.succeeded":
      return { ...state, terminal: "active" };
    case "terminal.throttled":
      return { ...state, terminal: "throttled" };
    case "terminal.error":
      return { ...state, terminal: "errored" };
    case "terminal.stopped":
      return { ...state, terminal: "stopped" };
    default:
      return state;
  }
}
