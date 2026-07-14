/**
 * FR-HELIOS-060: Boundary Adapter Dispatch Tests
 * Verifies: FR-BUS-003 (Method registry dispatch), FR-PVD-004 (MCP integration), FR-PVD-005 (A2A integration)
 */
import { describe, expect, test } from "bun:test";
import {
  createBoundaryDispatcher,
  getBoundaryDispatchDecision,
} from "../../../src/protocol/boundary_adapter";
import type { LocalBusEnvelope } from "../../../src/protocol/types";

function command(method: string): LocalBusEnvelope {
  return {
    id: `cmd-${method}`,
    type: "command",
    ts: "2026-02-27T00:00:00.000Z",
    method: method as never,
    payload: {},
    correlation_id: "corr-1",
    workspace_id: "ws-1",
  };
}

describe("boundary adapter mapping", () => {
  test("maps local, tool, and a2a methods to explicit boundary adapters", () => {
    expect(getBoundaryDispatchDecision("terminal.spawn")).toEqual({
      boundary: "local_control",
      adapter: "local_bus",
    });
    expect(getBoundaryDispatchDecision("share.upterm.start")).toEqual({
      boundary: "tool_interop",
      adapter: "tool_bridge",
    });
    expect(getBoundaryDispatchDecision("agent.run")).toEqual({
      boundary: "agent_delegation",
      adapter: "a2a_bridge",
    });
  });

  test("dispatches local methods through local adapter", async () => {
    const dispatcher = createBoundaryDispatcher({
      dispatchLocal: async () => ({
        id: "cmd-local",
        type: "response",
        ts: "2026-02-27T00:00:00.000Z",
        method: "terminal.spawn",
        status: "ok",
        result: { ok: true },
      }),
    });

    const response = await dispatcher(command("terminal.spawn"));
    expect(response.type).toBe("response");
    expect(response.status).toBe("ok");
  });

  test("returns normalized fail-closed response when tool adapter is unavailable", async () => {
    const dispatcher = createBoundaryDispatcher({
      dispatchLocal: async () => ({
        id: "cmd-local",
        type: "response",
        ts: "2026-02-27T00:00:00.000Z",
        method: "terminal.spawn",
        status: "ok",
        result: {},
      }),
    });

    const response = await dispatcher(command("boundary.tool.dispatch"));
    expect(response.type).toBe("response");
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("UNSUPPORTED_BOUNDARY_ADAPTER");
    expect(response.error?.details?.boundary).toBe("tool_interop");
  });

  test("routes a2a methods to provided adapter", async () => {
    const dispatcher = createBoundaryDispatcher({
      dispatchLocal: async () => ({
        id: "cmd-local",
        type: "response",
        ts: "2026-02-27T00:00:00.000Z",
        method: "terminal.spawn",
        status: "ok",
        result: {},
      }),
      dispatchA2A: async () => ({
        id: "cmd-a2a",
        type: "response",
        ts: "2026-02-27T00:00:00.000Z",
        method: "agent.run",
        status: "ok",
        result: { delegated: true },
      }),
    });

    const response = await dispatcher(command("agent.run"));
    expect(response.type).toBe("response");
    expect(response.status).toBe("ok");
    expect(response.result?.delegated).toBe(true);
  });
});
