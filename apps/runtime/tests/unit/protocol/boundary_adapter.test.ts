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

  test("emits the authoritative success topic for every boundary", async () => {
    const events: LocalBusEnvelope[] = [];
    const success = async (input: LocalBusEnvelope): Promise<LocalBusEnvelope> => ({
      id: input.id,
      type: "response",
      ts: "2026-02-27T00:00:00.000Z",
      status: "ok",
      result: {},
    });
    const dispatcher = createBoundaryDispatcher({
      dispatchLocal: success,
      dispatchTool: success,
      dispatchA2A: success,
      publishBoundaryEvent: event => {
        events.push(event);
      },
    });

    await dispatcher(command("boundary.local.dispatch"));
    await dispatcher(command("boundary.tool.dispatch"));
    await dispatcher(command("boundary.a2a.dispatch"));

    expect(events.map(event => event.topic)).toEqual([
      "boundary.local.dispatched",
      "boundary.tool.dispatched",
      "boundary.a2a.delegated",
    ]);
    expect(events.map(event => event.payload?.boundary)).toEqual([
      "local_control",
      "tool_interop",
      "agent_delegation",
    ]);
  });

  test("emits correlated failure before returning a normalized adapter error", async () => {
    const order: string[] = [];
    let failureEvent: LocalBusEnvelope | undefined;
    const dispatcher = createBoundaryDispatcher({
      dispatchLocal: async () => {
        throw new Error("adapter exploded");
      },
      publishBoundaryEvent: async event => {
        await Promise.resolve();
        failureEvent = event;
        order.push("event");
      },
    });

    const response = await dispatcher(command("boundary.local.dispatch"));
    order.push("return");

    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("BOUNDARY_DISPATCH_FAILED");
    expect(failureEvent?.topic).toBe("boundary.dispatch.failed");
    expect(failureEvent?.correlation_id).toBe("corr-1");
    expect(failureEvent?.workspace_id).toBe("ws-1");
    expect(failureEvent?.payload).toEqual({
      method: "boundary.local.dispatch",
      boundary: "local_control",
      adapter: "local_bus",
      outcome: "error",
      error_code: "BOUNDARY_DISPATCH_FAILED",
    });
    expect(order).toEqual(["event", "return"]);
  });
});
