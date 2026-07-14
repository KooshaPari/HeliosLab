/**
 * FR-HELIOS-088: Protocol Boundary Dispatch Integration Tests
 * Verifies: FR-PVD-004 (MCP integration), FR-PVD-005 (A2A integration)
 */
import { describe, expect, it } from "bun:test";
import { createRuntime } from "../../../src/index";

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("protocol boundary dispatch", () => {
  it("routes local boundary methods and returns deterministic success payload", async () => {
    const runtime = createRuntime();
    const response = await runtime.fetch(
      jsonRequest("http://localhost/v1/protocol/dispatch", {
        method: "renderer.capabilities",
        workspace_id: "ws_1",
        correlation_id: "corr-1",
        payload: {},
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      active_engine: string;
      hot_swap_supported: boolean;
    };
    expect(body.active_engine).toBe("ghostty");
    expect(body.hot_swap_supported).toBeTrue();
  });

  it("fails closed for unsupported tool boundary adapters", async () => {
    const runtime = createRuntime();
    const response = await runtime.fetch(
      jsonRequest("http://localhost/v1/protocol/dispatch", {
        method: "boundary.tool.dispatch",
        workspace_id: "ws_1",
        correlation_id: "corr-tool",
        payload: {},
      })
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: string;
      details: { boundary: string; adapter: string };
    };
    expect(body.error).toBe("UNSUPPORTED_BOUNDARY_ADAPTER");
    expect(body.details.boundary).toBe("tool_interop");
    expect(body.details.adapter).toBe("tool_bridge");
  });

  it("fails closed for unsupported a2a boundary adapters", async () => {
    const runtime = createRuntime();
    const response = await runtime.fetch(
      jsonRequest("http://localhost/v1/protocol/dispatch", {
        method: "boundary.a2a.dispatch",
        workspace_id: "ws_1",
        correlation_id: "corr-a2a",
        payload: {},
      })
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: string;
      details: { boundary: string; adapter: string };
    };
    expect(body.error).toBe("UNSUPPORTED_BOUNDARY_ADAPTER");
    expect(body.details.boundary).toBe("agent_delegation");
    expect(body.details.adapter).toBe("a2a_bridge");
  });
});
