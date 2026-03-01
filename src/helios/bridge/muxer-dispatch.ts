/**
 * Muxer Dispatch Module
 *
 * Routes muxer commands to terminal multiplexer adapters.
 * Supports: muxer.list, muxer.spawn, muxer.attach, muxer.detach,
 * muxer.kill
 */

import type { LocalBusEnvelope } from "../runtime/protocol/types";

type CommandDispatch = (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>;

interface MuxerSession {
  id: string;
  type: string;
  name?: string;
  status: "active" | "inactive" | "terminated";
  createdAt: string;
}

// Available muxer types
const MUXER_TYPES = ["zellij", "tmate", "upterm", "par", "zmx"];

// Track active muxer sessions
const activeSessions = new Map<string, MuxerSession>();

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

function successResponse(
  command: LocalBusEnvelope,
  result: Record<string, unknown>,
): LocalBusEnvelope {
  return {
    id: command.id,
    type: "response",
    ts: new Date().toISOString(),
    status: "ok",
    result,
    error: null,
  };
}

export function createMuxerDispatch(): CommandDispatch {
  return async (command: LocalBusEnvelope): Promise<LocalBusEnvelope> => {
    const method = command.method;
    const payload = (command.payload ?? {}) as Record<string, unknown>;

    switch (method) {
      case "muxer.list": {
        return successResponse(command, {
          available: MUXER_TYPES,
          count: MUXER_TYPES.length,
        });
      }

      case "muxer.spawn": {
        try {
          const muxerType = (payload?.type as string) || "";
          const sessionName = (payload?.name as string) || `mux-${Date.now()}`;

          if (!muxerType) {
            return errorResponse(
              command,
              "MUXER_TYPE_REQUIRED",
              "muxer type is required in payload",
            );
          }

          if (!MUXER_TYPES.includes(muxerType)) {
            return errorResponse(
              command,
              "UNSUPPORTED_MUXER_TYPE",
              `unsupported muxer type: ${muxerType}`,
            );
          }

          const newSession: MuxerSession = {
            id: `${muxerType}-${Date.now()}-${Math.random().toString(36).slice(7)}`,
            type: muxerType,
            name: sessionName,
            status: "active",
            createdAt: new Date().toISOString(),
          };

          activeSessions.set(newSession.id, newSession);

          return successResponse(command, {
            sessionId: newSession.id,
            type: muxerType,
            name: sessionName,
            status: "active",
            createdAt: newSession.createdAt,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResponse(command, "MUXER_SPAWN_FAILED", `Failed to spawn muxer: ${message}`);
        }
      }

      case "muxer.attach": {
        try {
          const targetSessionId = (payload?.sessionId as string) || "";

          if (!targetSessionId) {
            return errorResponse(
              command,
              "SESSION_ID_REQUIRED",
              "sessionId is required in payload",
            );
          }

          const session = activeSessions.get(targetSessionId);
          if (!session) {
            return errorResponse(
              command,
              "MUXER_SESSION_NOT_FOUND",
              `muxer session ${targetSessionId} not found`,
            );
          }

          if (session.status !== "active") {
            return errorResponse(
              command,
              "MUXER_SESSION_INACTIVE",
              `muxer session ${targetSessionId} is not active`,
            );
          }

          return successResponse(command, {
            sessionId: session.id,
            type: session.type,
            name: session.name,
            status: "active",
            attached: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResponse(
            command,
            "MUXER_ATTACH_FAILED",
            `Failed to attach muxer: ${message}`,
          );
        }
      }

      case "muxer.detach": {
        try {
          const targetSessionId = (payload?.sessionId as string) || "";

          if (!targetSessionId) {
            return errorResponse(
              command,
              "SESSION_ID_REQUIRED",
              "sessionId is required in payload",
            );
          }

          const session = activeSessions.get(targetSessionId);
          if (!session) {
            return errorResponse(
              command,
              "MUXER_SESSION_NOT_FOUND",
              `muxer session ${targetSessionId} not found`,
            );
          }

          return successResponse(command, {
            sessionId: session.id,
            type: session.type,
            name: session.name,
            status: "active",
            detached: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResponse(
            command,
            "MUXER_DETACH_FAILED",
            `Failed to detach muxer: ${message}`,
          );
        }
      }

      case "muxer.kill": {
        try {
          const targetSessionId = (payload?.sessionId as string) || "";

          if (!targetSessionId) {
            return errorResponse(
              command,
              "SESSION_ID_REQUIRED",
              "sessionId is required in payload",
            );
          }

          const session = activeSessions.get(targetSessionId);
          if (!session) {
            return errorResponse(
              command,
              "MUXER_SESSION_NOT_FOUND",
              `muxer session ${targetSessionId} not found`,
            );
          }

          session.status = "terminated";
          activeSessions.delete(targetSessionId);

          return successResponse(command, {
            sessionId: session.id,
            type: session.type,
            name: session.name,
            status: "terminated",
            killed: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResponse(command, "MUXER_KILL_FAILED", `Failed to kill muxer: ${message}`);
        }
      }

      default: {
        return errorResponse(command, "UNKNOWN_MUXER_METHOD", `unknown muxer method: ${method}`);
      }
    }
  };
}
