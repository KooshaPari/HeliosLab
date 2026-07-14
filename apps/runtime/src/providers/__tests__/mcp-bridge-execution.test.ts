import { describe, expect, it, beforeEach } from "vitest";
import { createMcpBridgeFixture, initMcpBridge } from "./mcp-bridge-test-helpers.js";

describe("MCP Bridge Adapter - Execution", () => {
  let adapter: ReturnType<typeof createMcpBridgeFixture>["adapter"];
  let bus: ReturnType<typeof createMcpBridgeFixture>["bus"];

  beforeEach(async () => {
    const fixture = createMcpBridgeFixture();
    adapter = fixture.adapter;
    bus = fixture.bus;
    await initMcpBridge(adapter);
  });

  it("executes a tool successfully", async () => {
    const result = await adapter.execute(
      {
        toolName: "read_file",
        arguments: { path: "/tmp/test.txt" },
      },
      "corr-123"
    );

    expect(result.isError).toBe(false);
    expect(result.result).toBeDefined();
  });

  it("propagates correlation ID", async () => {
    const correlationId = "unique-trace-id";

    await adapter.execute(
      {
        toolName: "read_file",
        arguments: { path: "/tmp/test.txt" },
      },
      correlationId
    );

    const events = bus.getEvents();
    const executeEvent = events.find(event => event.topic === "provider.mcp.tool.executed");
    expect(executeEvent?.payload?.correlationId).toBe(correlationId);
  });

  it("emits execution completed event", async () => {
    bus.getEvents();

    await adapter.execute(
      {
        toolName: "read_file",
        arguments: { path: "/tmp/test.txt" },
      },
      "corr-123"
    );

    const events = bus.getEvents();
    const completedEvent = events.find(event => event.topic === "provider.mcp.tool.executed");
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.payload?.toolName).toBe("read_file");
    expect(completedEvent?.payload?.duration).toBeGreaterThanOrEqual(0);
  });

  it("handles multiple concurrent tool invocations", async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        adapter.execute(
          {
            toolName: "read_file",
            arguments: { path: `/file${i}.txt` },
          },
          `corr-${i}`
        )
      );
    }

    const _results = await Promise.all(promises);

    expect(results).toHaveLength(5);
    results.forEach(result => {
      expect(result.isError).toBe(false);
      expect(result.result).toBeDefined();
    });
  });
});
