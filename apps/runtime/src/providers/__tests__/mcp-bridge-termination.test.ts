import { describe, expect, it, beforeEach } from "vitest";
import { createMcpBridgeFixture, initMcpBridge } from "./mcp-bridge-test-helpers.js";

describe("MCP Bridge Adapter - Termination", () => {
  let adapter: ReturnType<typeof createMcpBridgeFixture>["adapter"];
  let bus: ReturnType<typeof createMcpBridgeFixture>["bus"];

  beforeEach(async () => {
    const fixture = createMcpBridgeFixture();
    adapter = fixture.adapter;
    bus = fixture.bus;
    await initMcpBridge(adapter);
  });

  it("terminates successfully", async () => {
    let health = await adapter.health();
    expect(health.state).toBe("healthy");

    await adapter.terminate();

    health = await adapter.health();
    expect(health.state).toBe("unavailable");
    expect(health.message).toContain("Terminated");
  });

  it("emits termination event", async () => {
    bus.getEvents();

    await adapter.terminate();

    const events = bus.getEvents();
    const terminatedEvent = events.find(event => event.topic === "provider.mcp.terminated");
    expect(terminatedEvent).toBeDefined();
  });

  it("prevents execution after termination", async () => {
    await adapter.terminate();

    await expect(
      adapter.execute(
        {
          toolName: "read_file",
          arguments: { path: "/tmp/test.txt" },
        },
        "corr-123"
      )
    ).rejects.toThrow(/unavailable/i);
  });

  it("cancels in-flight tools on terminate", async () => {
    const executePromise = adapter.execute(
      {
        toolName: "read_file",
        arguments: { path: "/tmp/test.txt" },
      },
      "corr-123"
    );

    await adapter.terminate();

    await expect(executePromise).rejects.toThrow();
  });
});
