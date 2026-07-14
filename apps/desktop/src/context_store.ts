import type { RuntimeState } from "../../runtime/src/sessions/state_machine";

export type ActiveTab = "terminal" | "agent" | "session" | "chat" | "project";

export type AsyncStatus = "idle" | "loading" | "ready" | "error";

export type TransportDiagnostics = {
  preferredTransport: string;
  resolvedTransport: string;
  degradedReason: string | null;
  degradedAt: string | null;
};

export type ContextActionTrace = {
  action: string;
  at: string;
  detail?: unknown;
};

export type OperationState = {
  lane: AsyncStatus;
  session: AsyncStatus;
  terminal: AsyncStatus;
  renderer: AsyncStatus;
  error: string | null;
};

export type OperationKey = Exclude<keyof OperationState, "error">;

export type ActiveContextState = {
  workspaceId: string | null;
  laneId: string | null;
  sessionId: string | null;
  terminalId: string | null;
  activeTab: ActiveTab;
  runtimeState: RuntimeState | null;
  diagnostics: TransportDiagnostics;
  operations: OperationState;
  trace: ContextActionTrace[];
  rendererSwitch: {
    inFlight: boolean;
    previousEngine: string | null;
    targetEngine: string | null;
    lastStatus: "idle" | "started" | "succeeded" | "failed" | "rolled_back";
    message: string | null;
  };
};

export type ActiveContextAction =
  | { type: "workspace.set"; workspaceId: string }
  | { type: "lane.set"; laneId: string }
  | { type: "session.set"; sessionId: string }
  | { type: "terminal.set"; terminalId: string }
  | { type: "tab.set"; tab: ActiveTab }
  | { type: "runtime.state.set"; runtimeState: RuntimeState }
  | { type: "operation.start"; operation: OperationKey }
  | { type: "operation.success"; operation: OperationKey }
  | { type: "operation.failure"; operation: OperationKey; error: string }
  | { type: "diagnostics.set"; diagnostics: TransportDiagnostics }
  | {
      type: "renderer.switch.started";
      previousEngine: string;
      targetEngine: string;
    }
  | { type: "renderer.switch.succeeded"; targetEngine: string }
  | { type: "renderer.switch.failed"; message: string }
  | { type: "renderer.switch.rolled_back"; engine: string; message: string };

export const DEFAULT_TRANSPORT_DIAGNOSTICS: TransportDiagnostics = {
  preferredTransport: "cliproxy_harness",
  resolvedTransport: "cliproxy_harness",
  degradedReason: null,
  degradedAt: null,
};

export const INITIAL_ACTIVE_CONTEXT_STATE: ActiveContextState = {
  workspaceId: null,
  laneId: null,
  sessionId: null,
  terminalId: null,
  activeTab: "terminal",
  runtimeState: null,
  diagnostics: DEFAULT_TRANSPORT_DIAGNOSTICS,
  operations: {
    lane: "idle",
    session: "idle",
    terminal: "idle",
    renderer: "idle",
    error: null,
  },
  trace: [],
  rendererSwitch: {
    inFlight: false,
    previousEngine: null,
    targetEngine: null,
    lastStatus: "idle",
    message: null,
  },
};

function appendTrace(
  trace: ContextActionTrace[],
  action: string,
  detail?: unknown
): ContextActionTrace[] {
  return [...trace, { action, at: new Date().toISOString(), detail }];
}

export function reduceActiveContextState(
  state: ActiveContextState,
  action: ActiveContextAction
): ActiveContextState {
  switch (action.type) {
    case "workspace.set":
      return {
        ...state,
        workspaceId: action.workspaceId,
        laneId: null,
        sessionId: null,
        terminalId: null,
        trace: appendTrace(state.trace, action.type, {
          workspaceId: action.workspaceId,
        }),
      };
    case "lane.set":
      return {
        ...state,
        laneId: action.laneId,
        trace: appendTrace(state.trace, action.type, { laneId: action.laneId }),
      };
    case "session.set":
      return {
        ...state,
        sessionId: action.sessionId,
        trace: appendTrace(state.trace, action.type, {
          sessionId: action.sessionId,
        }),
      };
    case "terminal.set":
      return {
        ...state,
        terminalId: action.terminalId,
        trace: appendTrace(state.trace, action.type, {
          terminalId: action.terminalId,
        }),
      };
    case "tab.set":
      return {
        ...state,
        activeTab: action.tab,
        trace: appendTrace(state.trace, action.type, { tab: action.tab }),
      };
    case "runtime.state.set":
      return {
        ...state,
        runtimeState: action.runtimeState,
        trace: appendTrace(state.trace, action.type, {
          runtimeState: action.runtimeState,
        }),
      };
    case "operation.start":
      return {
        ...state,
        operations: {
          ...state.operations,
          [action.operation]: "loading",
          error: null,
        },
        trace: appendTrace(state.trace, action.type, {
          operation: action.operation,
        }),
      };
    case "operation.success":
      return {
        ...state,
        operations: {
          ...state.operations,
          [action.operation]: "ready",
          error: null,
        },
        trace: appendTrace(state.trace, action.type, {
          operation: action.operation,
        }),
      };
    case "operation.failure":
      return {
        ...state,
        operations: {
          ...state.operations,
          [action.operation]: "error",
          error: action.error,
        },
        trace: appendTrace(state.trace, action.type, {
          operation: action.operation,
          error: action.error,
        }),
      };
    case "diagnostics.set":
      return {
        ...state,
        diagnostics: action.diagnostics,
        trace: appendTrace(state.trace, action.type, {
          diagnostics: action.diagnostics,
        }),
      };
    case "renderer.switch.started":
      return {
        ...state,
        operations: {
          ...state.operations,
          renderer: "loading",
          error: null,
        },
        rendererSwitch: {
          inFlight: true,
          previousEngine: action.previousEngine,
          targetEngine: action.targetEngine,
          lastStatus: "started",
          message: null,
        },
        trace: appendTrace(state.trace, action.type, {
          previousEngine: action.previousEngine,
          targetEngine: action.targetEngine,
        }),
      };
    case "renderer.switch.succeeded":
      return {
        ...state,
        operations: {
          ...state.operations,
          renderer: "ready",
          error: null,
        },
        rendererSwitch: {
          ...state.rendererSwitch,
          inFlight: false,
          lastStatus: "succeeded",
          targetEngine: action.targetEngine,
        },
        trace: appendTrace(state.trace, action.type, {
          targetEngine: action.targetEngine,
        }),
      };
    case "renderer.switch.failed":
      return {
        ...state,
        operations: {
          ...state.operations,
          renderer: "error",
          error: action.message,
        },
        rendererSwitch: {
          ...state.rendererSwitch,
          inFlight: false,
          lastStatus: "failed",
          message: action.message,
        },
        trace: appendTrace(state.trace, action.type, {
          message: action.message,
        }),
      };
    case "renderer.switch.rolled_back":
      return {
        ...state,
        operations: {
          ...state.operations,
          renderer: "ready",
          error: null,
        },
        rendererSwitch: {
          inFlight: false,
          previousEngine: action.engine,
          targetEngine: action.engine,
          lastStatus: "rolled_back",
          message: action.message,
        },
        trace: appendTrace(state.trace, action.type, {
          engine: action.engine,
          message: action.message,
        }),
      };
    default:
      return state;
  }
}

type StoreListener = (state: ActiveContextState, action: ActiveContextAction) => void;

export class ActiveContextStore {
  private state: ActiveContextState;
  private readonly listeners = new Set<StoreListener>();

  constructor(initialState: ActiveContextState = INITIAL_ACTIVE_CONTEXT_STATE) {
    this.state = initialState;
  }

  getState(): ActiveContextState {
    return this.state;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispatch(action: ActiveContextAction): ActiveContextState {
    this.state = reduceActiveContextState(this.state, action);
    for (const listener of this.listeners) {
      listener(this.state, action);
    }
    return this.state;
  }
}

export type ActiveContextIdentifiers = {
  workspaceId: string | null;
  laneId: string | null;
  sessionId: string | null;
  terminalId: string | null;
  activeTab: ActiveTab;
};

export function selectActiveContext(state: ActiveContextState): ActiveContextIdentifiers {
  return {
    workspaceId: state.workspaceId,
    laneId: state.laneId,
    sessionId: state.sessionId,
    terminalId: state.terminalId,
    activeTab: state.activeTab,
  };
}

export function selectRuntimeDiagnostics(state: ActiveContextState): TransportDiagnostics {
  return state.diagnostics;
}

export function selectRendererSwitchStatus(
  state: ActiveContextState
): ActiveContextState["rendererSwitch"] {
  return state.rendererSwitch;
}
