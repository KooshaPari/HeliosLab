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

function okResponse(command: LocalBusEnvelope, result: Record<string, unknown>): LocalBusEnvelope {
  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result,
  };
}

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

export function createToolDispatch(): CommandDispatch {
  return async (command: LocalBusEnvelope): Promise<LocalBusEnvelope> => {
    const method = command.method;
    const payload = (command.payload ?? {}) as Record<string, unknown>;

    try {
      switch (method) {
        case "share.upterm.start": {
          const { shareUrl } = await upterm.startShare(payload.terminalId as string);
          return okResponse(command, { shareUrl });
        }
        case "share.upterm.stop": {
          await upterm.stopShare(payload.terminalId as string);
          return okResponse(command, {});
        }
        case "share.tmate.start": {
          const result = await tmate.startShare(payload.terminalId as string);
          return okResponse(command, result);
        }
        case "share.tmate.stop": {
          await tmate.stopShare(payload.terminalId as string);
          return okResponse(command, {});
        }
        case "zmx.checkpoint": {
          const checkpointId = await zmx.checkpoint(payload.sessionId as string);
          return okResponse(command, { checkpointId });
        }
        case "zmx.restore": {
          await zmx.restore(payload.checkpointId as string);
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
