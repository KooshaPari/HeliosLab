/**
 * Tool Interop Boundary Dispatcher
 *
 * Routes tool_interop commands to concrete adapter implementations:
 * - share.upterm.* → UptermCommandAdapter
 * - share.tmate.* → TmateCommandAdapter
 * - zmx.* → ZmxCommandAdapter
 */

import type { LocalBusEnvelope } from "../runtime/protocol/types";
import { UptermCommandAdapter } from "../runtime/integrations/upterm/command";
import { TmateCommandAdapter } from "../runtime/integrations/tmate/command";
import { ZmxCommandAdapter } from "../runtime/integrations/zmx/command";

type CommandDispatch = (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>;

const upterm = new UptermCommandAdapter();
const tmate = new TmateCommandAdapter();
const zmx = new ZmxCommandAdapter();

function okResponse(
  command: Readonly<LocalBusEnvelope>,
  result: Readonly<Record<string, unknown>>,
): LocalBusEnvelope {
  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result,
  };
}

function errorResponse(
  command: Readonly<LocalBusEnvelope>,
  code: string,
  message: string,
): LocalBusEnvelope {
  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    status: "error",
    result: null,
    error: { code, message, retryable: false, details: { method: command.method } },
  };
}

export function createToolDispatch(): CommandDispatch {
  return async (command: LocalBusEnvelope): Promise<LocalBusEnvelope> => {
    const method = command.method;
    const payload =
      typeof command.payload === "object" && command.payload !== null
        ? command.payload
        : {};

    const readString = (key: string): string | null => {
      const value = payload[key];
      return typeof value === "string" ? value : null;
    };

    try {
      switch (method) {
        case "share.upterm.start": {
          const terminalId = readString("terminalId");
          if (terminalId === null) {
            return errorResponse(command, "INVALID_TOOL_PAYLOAD", "terminalId must be a string");
          }
          const { shareUrl } = await upterm.startShare(terminalId);
          return okResponse(command, { shareUrl });
        }
        case "share.upterm.stop": {
          const terminalId = readString("terminalId");
          if (terminalId === null) {
            return errorResponse(command, "INVALID_TOOL_PAYLOAD", "terminalId must be a string");
          }
          await upterm.stopShare(terminalId);
          return okResponse(command, {});
        }
        case "share.tmate.start": {
          const terminalId = readString("terminalId");
          if (terminalId === null) {
            return errorResponse(command, "INVALID_TOOL_PAYLOAD", "terminalId must be a string");
          }
          const result = await tmate.startShare(terminalId);
          return okResponse(command, result);
        }
        case "share.tmate.stop": {
          const terminalId = readString("terminalId");
          if (terminalId === null) {
            return errorResponse(command, "INVALID_TOOL_PAYLOAD", "terminalId must be a string");
          }
          await tmate.stopShare(terminalId);
          return okResponse(command, {});
        }
        case "zmx.checkpoint": {
          const sessionId = readString("sessionId");
          if (sessionId === null) {
            return errorResponse(command, "INVALID_TOOL_PAYLOAD", "sessionId must be a string");
          }
          const checkpointId = await zmx.checkpoint(sessionId);
          return okResponse(command, { checkpointId });
        }
        case "zmx.restore": {
          const checkpointId = readString("checkpointId");
          if (checkpointId === null) {
            return errorResponse(command, "INVALID_TOOL_PAYLOAD", "checkpointId must be a string");
          }
          await zmx.restore(checkpointId);
          return okResponse(command, {});
        }
        default: {
          return errorResponse(command, "UNKNOWN_TOOL_METHOD", `unknown tool method: ${method}`);
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return errorResponse(command, "TOOL_EXECUTION_FAILED", errorMessage);
    }
  };
}
