/**
 * Bus-RPC Bridge
 *
 * Bridges the helios LocalBus protocol with ElectroBun's RPC layer.
 * Routes commands through the boundary dispatcher, persists state
 * changes to GoldfishDB, and broadcasts events to renderers.
 */

import { type InMemoryLocalBus } from "../runtime/protocol/bus";
import type { LocalBusEnvelope } from "../runtime/protocol/types";
import { createBoundaryDispatcher, getBoundaryDispatchDecision } from "../runtime/protocol/boundary_adapter";
import { broadcastToAllWindowsInWorkspace } from "../../main/workspaceWindows";
import { upsertLane, writeAuditEntry } from "./persistence";

export type BusRpcBridge = {
  /** Forward an RPC request to the bus and return the response */
  handleRequest(method: string, params: Record<string, unknown>): Promise<LocalBusEnvelope>;
  /** Stop listening to bus events */
  dispose(): void;
};

/**
 * Creates a bridge between the helios LocalBus and ElectroBun RPC.
 *
 * - Incoming RPC requests are routed through the boundary dispatcher
 * - State changes are persisted to GoldfishDB
 * - Bus events are broadcast to all windows in the workspace via RPC
 */
export function createBusRpcBridge(
  bus: InMemoryLocalBus,
  workspaceId: string,
): BusRpcBridge {
  let disposed = false;

  // Create boundary dispatcher that routes commands to the bus
  const dispatch = createBoundaryDispatcher({
    dispatchLocal: (command) => bus.request(command),
    // tool_interop and agent_delegation stubs return errors (wired in Phase 3)
  });

  // Poll bus events and forward to renderers
  let lastEventIndex = 0;
  const pollInterval = setInterval(() => {
    if (disposed) return;

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
      const envelope: LocalBusEnvelope = {
        type: "command",
        method,
        payload: params,
        meta: {
          workspace_id: workspaceId,
          session_id: (params.session_id as string) ?? null,
          correlation_id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        },
      };

      // Route through boundary dispatcher
      const decision = getBoundaryDispatchDecision(method);
      const response = await dispatch(envelope);

      const state = bus.getState();

      // Persist lane state after lifecycle commands
      if (method === "lane.create" || method === "session.attach" || method === "terminal.spawn") {
        const result = response.result as Record<string, unknown> | null;
        const laneId = (result?.lane_id as string) ?? (params.lane_id as string) ?? (params.id as string)?.split(":")[0] ?? null;
        if (laneId) {
          try {
            upsertLane({
              workspaceId,
              laneId,
              sessionId: (result?.session_id as string) ?? null,
              terminalId: (result?.terminal_id as string) ?? null,
              transport: (result?.diagnostics as Record<string, unknown>)?.resolved_transport as string ?? "cliproxy_harness",
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
