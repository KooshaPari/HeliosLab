import { describe, expect, it } from "bun:test";

import type { MonotonicClock } from "../../diagnostics/hooks.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { A2ARouterAdapter } from "../a2a-router.js";
import { ACPClientAdapter } from "../acp-client.js";
import { MCPBridgeAdapter } from "../mcp-bridge.js";

function sequenceClock(...timestamps: number[]): MonotonicClock {
  let index = 0;
  return {
    now(): number {
      const timestamp = timestamps[index];
      if (timestamp === undefined) {
        throw new Error("Monotonic clock sequence exhausted");
      }
      index += 1;
      return timestamp;
    },
  };
}

async function withRollingBackWallClock(run: () => Promise<void>): Promise<void> {
  const originalDateNow = Date.now;
  let wallTime = 1_000;
  Date.now = () => --wallTime;

  try {
    await run();
  } finally {
    Date.now = originalDateNow;
  }
}

describe("provider monotonic timing", () => {
  it("measures ACP initialization and execution when wall time rolls back", async () => {
    await withRollingBackWallClock(async () => {
      const bus = new InMemoryLocalBus();
      const adapter = new ACPClientAdapter(bus, undefined, sequenceClock(100, 105, 200, 207));

      await adapter.init({
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",
        model: "claude-3-sonnet",
        timeout: 30_000,
      });
      await adapter.execute({ prompt: "Test" }, "corr-acp");

      const event = bus
        .getEvents()
        .find(candidate => candidate.topic === "provider.acp.execute.completed");
      expect(event?.payload?.["duration"]).toBe(7);
    });
  });

  it("measures MCP tool execution when wall time rolls back", async () => {
    await withRollingBackWallClock(async () => {
      const bus = new InMemoryLocalBus();
      const adapter = new MCPBridgeAdapter(bus, sequenceClock(300, 311));

      await adapter.init({
        serverPath: "stdio",
        args: [],
        timeout: 30_000,
      });
      await adapter.execute(
        { toolName: "read_file", arguments: { path: "/tmp/test.txt" } },
        "corr-mcp"
      );

      const event = bus
        .getEvents()
        .find(candidate => candidate.topic === "provider.mcp.tool.executed");
      expect(event?.payload?.["duration"]).toBe(11);
    });
  });

  it("measures A2A delegation when wall time rolls back", async () => {
    await withRollingBackWallClock(async () => {
      const bus = new InMemoryLocalBus();
      const adapter = new A2ARouterAdapter(bus, sequenceClock(400, 413));

      await adapter.init({
        agentId: "agent-1",
        endpoint: "http://localhost:9000",
        endpoints: [
          {
            id: "agent-1",
            url: "http://localhost:9000",
            priority: 1,
            capabilities: ["inference"],
          },
        ],
        timeout: 30_000,
      });
      const result = await adapter.execute(
        {
          taskDescription: "Test",
          requiredCapabilities: ["inference"],
          context: {},
        },
        "corr-a2a"
      );

      expect(result.duration).toBe(13);
    });
  });
});
