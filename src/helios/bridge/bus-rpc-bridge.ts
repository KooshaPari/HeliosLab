/**
 * Bus-RPC Bridge
 *
 * Bridges the helios LocalBus protocol with ElectroBun's RPC layer.
 * Routes commands through the boundary dispatcher, persists state
 * changes to GoldfishDB, and broadcasts events to renderers.
 */

import { type InMemoryLocalBus } from "../runtime/protocol/bus";
import type { LocalBusEnvelope } from "../runtime/protocol/types";
import {
  createBoundaryDispatcher,
  getBoundaryDispatchDecision,
} from "../runtime/protocol/boundary_adapter";
import { broadcastToAllWindowsInWorkspace } from "../../main/workspaceWindows";
import {
  upsertLane,
  writeAuditEntry,
  loadSessionSnapshot,
  saveSessionSnapshot,
} from "./persistence";
import type { RuntimeMetrics } from "../runtime/diagnostics/metrics";
import type { HeliosTerminalBridge } from "./terminal-bridge";
import { createMuxerDispatch } from "./muxer-dispatch";
import { createToolDispatch } from "./tool-dispatch";

type CommandDispatch = (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>;

export interface BusRpcBridgeOptions {
  bus: InMemoryLocalBus;
  workspaceId: string;
  dispatchTool?: CommandDispatch;
  dispatchA2A?: CommandDispatch;
  dispatchMuxer?: CommandDispatch;
  metrics?: RuntimeMetrics;
  termBridge?: HeliosTerminalBridge;
  windowId?: string;
}

export interface BusRpcBridge {
  /** Forward an RPC request to the bus and return the response */
  handleRequest(method: string, params: Record<string, unknown>): Promise<LocalBusEnvelope>;
  /** Stop listening to bus events */
  dispose(): void;
}

/**
 * Creates a bridge between the helios LocalBus and ElectroBun RPC.
 *
 * - Incoming RPC requests are routed through the boundary dispatcher
 * - State changes are persisted to GoldfishDB
 * - Bus events are broadcast to all windows in the workspace via RPC
 *
 * @param {BusRpcBridgeOptions} opts Configuration options for the bridge
 * @returns {BusRpcBridge} A BusRpcBridge instance
 */
export function createBusRpcBridge(opts: BusRpcBridgeOptions): BusRpcBridge {
  const {
    bus,
    workspaceId,
    dispatchTool,
    dispatchA2A,
    dispatchMuxer,
    metrics,
    termBridge,
    windowId,
  } = opts;
  let disposed = false;

  // Restore session snapshot on bridge creation
  try {
    const snapshot = loadSessionSnapshot(workspaceId);
    if (snapshot && snapshot.length > 0) {
      bus.restoreLanes(snapshot);
    }
  } catch {
    // Silently fail; start with fresh state
  }

  // Create combined tool dispatcher: tries tool dispatch first (for share.*/zmx.*),
  // Then muxer dispatch for unhandled methods
  const createCombinedDispatcher = (): CommandDispatch => {
    const toolDispatch = createToolDispatch();
    const muxerDispatch = createMuxerDispatch();

    return async (command: LocalBusEnvelope): Promise<LocalBusEnvelope> => {
      const method = command.method ?? "";

      // Route share.* and zmx.* to tool dispatch
      if (method.startsWith("share.") || method.startsWith("zmx.")) {
        return toolDispatch(command);
      }

      // Route muxer.* to muxer dispatch
      if (method.startsWith("muxer.")) {
        return muxerDispatch(command);
      }

      // Fallback to tool dispatch for unknown methods
      return toolDispatch(command);
    };
  };

  // Resolve tool dispatch: use provided dispatchTool, fall back to combined
  // Dispatcher that routes to tool and muxer dispatchers
  const resolvedDispatchTool = dispatchTool || dispatchMuxer || createCombinedDispatcher();

  // Create boundary dispatcher with all three boundaries
  const dispatch = createBoundaryDispatcher({
    dispatchLocal: (command) => bus.request(command),
    dispatchTool: resolvedDispatchTool,
    dispatchA2A,
  });

  // Poll bus events and forward to renderers
  let lastEventIndex = 0;
  const pollInterval = setInterval(() => {
    if (disposed) {return;}

    const events = bus.getEvents();
    if (events.length > lastEventIndex) {
      const newEvents = events.slice(lastEventIndex);
      lastEventIndex = events.length;
      for (const event of newEvents) {
        broadcastToAllWindowsInWorkspace(workspaceId, "helios:event", {
          event,
          state: bus.getState(),
        });
      }
    }
  }, 100);

  return {
    async handleRequest(
      method: string,
      params: Record<string, unknown>,
    ): Promise<LocalBusEnvelope> {
      // Handle lane.list query
      if (method === "lane.list") {
        const lanes = bus.getActiveLanes();
        return {
          id: crypto.randomUUID(),
          type: "response",
          ts: new Date().toISOString(),
          status: "ok",
          result: { lanes },
        };
      }

      // Handle session.reconnect
      if (method === "session.reconnect") {
        const laneId = params["laneId"] as string;
        if (!laneId) {
          return {
            id: crypto.randomUUID(),
            type: "response",
            ts: new Date().toISOString(),
            status: "error",
            result: null,
            error: {
              code: "SESSION_RECONNECT_FAILED",
              message: "laneId is required",
              retryable: false,
              details: { method: "session.reconnect" },
            },
          };
        }

        // Delegate to session.attach logic with the existing laneId
        const sessionEnvelope: LocalBusEnvelope = {
          id: crypto.randomUUID(),
          type: "command",
          ts: new Date().toISOString(),
          workspace_id: workspaceId,
          method: "session.attach",
          payload: { id: `${laneId}:session` },
          correlation_id: crypto.randomUUID(),
          meta: {
            workspace_id: workspaceId,
            session_id: (params["session_id"] as string) ?? null,
            correlation_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
          },
        };

        return await dispatch(sessionEnvelope);
      }

      const correlationId = crypto.randomUUID();
      const envelope: LocalBusEnvelope = {
        id: correlationId,
        type: "command",
        ts: new Date().toISOString(),
        workspace_id: workspaceId,
        method,
        payload: params,
        correlation_id: correlationId,
        meta: {
          workspace_id: workspaceId,
          session_id: (params["session_id"] as string) ?? null,
          correlation_id: correlationId,
          timestamp: new Date().toISOString(),
        },
      };

      // Route through boundary dispatcher with metrics
      const decision = getBoundaryDispatchDecision(method);
      let metricName: "lane_create_latency_ms" | "session_restore_latency_ms" | null = null;
      if (method === "lane.create") {
        metricName = "lane_create_latency_ms" as const;
      } else if (method === "session.attach") {
        metricName = "session_restore_latency_ms" as const;
      }

      if (metrics && metricName) {
        metrics.startTimer(metricName, envelope.meta?.correlation_id ?? method);
      }

      const response = await dispatch(envelope);

      if (metrics && metricName) {
        metrics.endTimer(metricName, envelope.meta?.correlation_id ?? method);
      }

      const state = bus.getState();

      // Persist lane state after lifecycle commands
      if (method === "lane.create" || method === "session.attach" || method === "terminal.spawn") {
        const result = response.result as Record<string, unknown> | null;
        const laneId =
          (result?.["lane_id"] as string) ??
          (params["lane_id"] as string) ??
          (params["id"] as string)?.split(":")[0] ??
          null;
        if (laneId) {
          try {
            upsertLane({
              workspaceId,
              laneId,
              sessionId: (result?.["session_id"] as string) ?? null,
              terminalId: (result?.["terminal_id"] as string) ?? null,
              transport:
                ((result?.["diagnostics"] as Record<string, unknown>)?.[
                  "resolved_transport"
                ] as string) ?? "cliproxy_harness",
              state: JSON.stringify(state),
              lastUpdated: new Date().toISOString(),
            });
          } catch {
            // Don't fail the command if persistence fails
          }
        }

        // Audit trail
        writeAuditEntry({
          action: method,
          workspaceId,
          laneId,
          sessionId: (result?.session_id as string) ?? null,
          detail: `${method} via ${decision.boundary}/${decision.adapter} — ${response.status}`,
        });

        // Spawn real pty terminal on terminal.spawn success
        if (method === "terminal.spawn" && response.status === "ok" && termBridge && windowId) {
          const termId = (result?.terminal_id as string) ?? (params.id as string);
          if (termId) {
            termBridge.spawnTerminal(termId, workspaceId, windowId);
          }
        }

        // Save session snapshot after lifecycle changes
        try {
          const exportedLanes = bus.exportLanes();
          saveSessionSnapshot(workspaceId, exportedLanes);
        } catch {
          // Don't fail the command if snapshot save fails
        }
      }

      // Broadcast state update after each command
      broadcastToAllWindowsInWorkspace(workspaceId, "helios:state", {
        state,
      });

      return response;
    },

    dispose() {
      disposed = true;
      clearInterval(pollInterval);
    },
  };
}
