/**
 * Bus-RPC Bridge
 *
 * Bridges the helios LocalBus protocol with ElectroBun's RPC layer.
 * Registers helios.* RPC handlers that forward to LocalBus and subscribes
 * to bus events to broadcast them to renderers.
 */

import type { LocalBus } from "../runtime/protocol/bus";
import type { LocalBusEnvelope } from "../runtime/protocol/types";
import { broadcastToAllWindowsInWorkspace } from "../../main/workspaceWindows";

export type BusRpcBridge = {
  /** Forward an RPC request to the bus and return the response */
  handleRequest(method: string, params: Record<string, unknown>): Promise<LocalBusEnvelope>;
  /** Stop listening to bus events */
  dispose(): void;
};

/**
 * Creates a bridge between the helios LocalBus and ElectroBun RPC.
 *
 * - Incoming RPC requests (helios.*) are forwarded to the bus as command envelopes
 * - Bus events are broadcast to all windows in the workspace via RPC
 */
export function createBusRpcBridge(
  bus: LocalBus,
  workspaceId: string,
): BusRpcBridge {
  let disposed = false;

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

      const response = await bus.request(envelope);

      // Broadcast state update after each command
      broadcastToAllWindowsInWorkspace(workspaceId, "helios:state", {
        state: bus.getState(),
      });

      return response;
    },

    dispose() {
      disposed = true;
      clearInterval(pollInterval);
    },
  };
}
