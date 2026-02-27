/**
 * Agent Delegation Boundary Dispatcher
 *
 * Routes agent_delegation commands to adapter stubs.
 * These adapters talk to external agent services (A2A, ACP, MCP)
 * and will be fully implemented when those services are available.
 */

import type { LocalBusEnvelope } from "../runtime/protocol/types";

type CommandDispatch = (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>;

function errorResponse(command: LocalBusEnvelope, code: string, message: string): LocalBusEnvelope {
  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    status: "error",
    result: null,
    error: { code, message, retryable: false, details: { method: command.method } },
  };
}

export function createA2ADispatch(): CommandDispatch {
  return async (command: LocalBusEnvelope): Promise<LocalBusEnvelope> => {
    const method = command.method;

    switch (method) {
      case "agent.run":
        return errorResponse(command, "A2A_NOT_CONFIGURED", "agent-to-agent delegation not configured — connect an A2A or ACP endpoint in settings");
      case "agent.cancel":
        return errorResponse(command, "A2A_NOT_CONFIGURED", "no active agent task to cancel");
      default:
        return errorResponse(command, "UNKNOWN_A2A_METHOD", `unknown a2a method: ${method}`);
    }
  };
}
