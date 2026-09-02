import { describe, expect, it, beforeEach } from "vitest";
import { createMcpBridgeFixture, initMcpBridge } from "./mcp-bridge-test-helpers.js";
import { NormalizedProviderError } from "../errors.js";

// Traces to: FR-MVP-019 (graceful fallback), FR-MVP-018 (switch providers)

describe("MCP Bridge Adapter - Error Handling", () => {
  let adapter: ReturnType<typeof createMcpBridgeFixture>["adapter"];
  let bus: ReturnType<typeof createMcpBridgeFixture>["bus"];

  beforeEach(async () => {
    const fixture = createMcpBridgeFixture();
    adapter = fixture.adapter;
    bus = fixture.bus;
    await initMcpBridge(adapter);
  });

  it("rejects execution before init", async () => {
    const fixture = createMcpBridgeFixture();

    await expect(
      fixture.adapter.execute(
        {
          toolName: "read_file",
          arguments: { path: "/tmp/test.txt" },
        },
        "corr-123"
      )
    ).rejects.toThrow(/unavailable/i);
  });

  it("rejects unknown tool with normalized error", async () => {
    const error = await adapter
      .execute(
        {
          toolName: "nonexistent_tool",
          arguments: {},
        },
        "corr-123"
      )
      .catch(caught => caught);

    expect(error).toBeInstanceOf(NormalizedProviderError);
  });

  it("emits error event on execution failure", async () => {
    bus.getEvents();

    try {
      await adapter.execute(
        {
          toolName: "nonexistent_tool",
          arguments: {},
        },
        "corr-123"
      );
    } catch {
      // Expected
    }

    const events = bus.getEvents();
    const errorEvent = events.find(event => event.topic === "provider.mcp.tool.failed");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.payload?.toolName).toBe("nonexistent_tool");
  });
});
