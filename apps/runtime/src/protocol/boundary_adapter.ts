import type { LocalBusEnvelope } from "./types";

export type ProtocolBoundary = "local_control" | "tool_interop" | "agent_delegation";
export type BoundaryAdapterName = "local_bus" | "tool_bridge" | "a2a_bridge";

export type BoundaryDispatchDecision = {
  boundary: ProtocolBoundary;
  adapter: BoundaryAdapterName;
};

type CommandDispatch = (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>;

type BoundaryDispatcherInput = {
  dispatchLocal: CommandDispatch;
  dispatchTool?: CommandDispatch;
  dispatchA2A?: CommandDispatch;
};

const LOCAL_METHODS = new Set([
  "runtime.workspace.create",
  "runtime.workspace.open",
  "runtime.project.clone",
  "runtime.project.init",
  "runtime.session.create",
  "runtime.session.attach",
  "runtime.session.terminate",
  "runtime.terminal.spawn",
  "runtime.terminal.resize",
  "runtime.terminal.input",
  "runtime.renderer.switch",
  "runtime.renderer.capabilities",
  "runtime.lane.create",
  "runtime.lane.attach",
  "runtime.lane.cleanup",
  "runtime.boundary.local.dispatch",
]);

const TOOL_METHODS = new Set([
  "runtime.approval.request.resolve",
  "runtime.share.upterm.start",
  "runtime.share.upterm.stop",
  "runtime.share.tmate.start",
  "runtime.share.tmate.stop",
  "runtime.zmx.checkpoint",
  "runtime.zmx.restore",
  "runtime.boundary.tool.dispatch",
]);

const A2A_METHODS = new Set(["runtime.agent.run", "runtime.agent.cancel", "runtime.boundary.a2a.dispatch"]);

function normalizedBoundaryError(
  command: LocalBusEnvelope,
  code: string,
  message: string,
  details: Record<string, unknown>
): LocalBusEnvelope {
  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    workspace_id: command.workspace_id,
    lane_id: command.lane_id,
    session_id: command.session_id,
    terminal_id: command.terminal_id,
    correlation_id: command.correlation_id,
    method: command.type === "command" ? command.method : undefined,
    status: "error",
    error: {
      code,
      message,
      retryable: false,
      details,
    },
  };
}

export function getBoundaryDispatchDecision(method: string): BoundaryDispatchDecision {
  if (LOCAL_METHODS.has(method)) {
    return { boundary: "local_control", adapter: "local_bus" };
  }
  if (TOOL_METHODS.has(method)) {
    return { boundary: "tool_interop", adapter: "tool_bridge" };
  }
  if (A2A_METHODS.has(method)) {
    return { boundary: "agent_delegation", adapter: "a2a_bridge" };
  }
  return { boundary: "local_control", adapter: "local_bus" };
}

export function createBoundaryDispatcher(input: BoundaryDispatcherInput): CommandDispatch {
  const dispatchTool =
    input.dispatchTool ??
    (async command =>
      normalizedBoundaryError(
        command,
        "UNSUPPORTED_BOUNDARY_ADAPTER",
        "tool_interop adapter unavailable",
        {
          boundary: "tool_interop",
          adapter: "tool_bridge",
          method: command.type === "command" ? command.method : null,
        }
      ));
  const dispatchA2A =
    input.dispatchA2A ??
    (async command =>
      normalizedBoundaryError(
        command,
        "UNSUPPORTED_BOUNDARY_ADAPTER",
        "agent_delegation adapter unavailable",
        {
          boundary: "agent_delegation",
          adapter: "a2a_bridge",
          method: command.type === "command" ? command.method : null,
        }
      ));

  return async (command: LocalBusEnvelope): Promise<LocalBusEnvelope> => {
    if (command.type !== "command") {
      return normalizedBoundaryError(
        command,
        "INVALID_ENVELOPE_TYPE",
        "command envelope required",
        {
          type: command.type,
        }
      );
    }

    const decision = getBoundaryDispatchDecision(command.method ?? "");
    const response =
      decision.adapter === "local_bus"
        ? await input.dispatchLocal(command)
        : decision.adapter === "tool_bridge"
          ? await dispatchTool(command)
          : await dispatchA2A(command);

    if (response.type === "response") {
      return response;
    }

    return normalizedBoundaryError(
      command,
      "INVALID_BOUNDARY_RESPONSE",
      "boundary adapter must return response",
      {
        boundary: decision.boundary,
        adapter: decision.adapter,
      }
    );
  };
}
