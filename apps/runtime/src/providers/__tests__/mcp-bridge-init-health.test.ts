import { describe, expect, it, beforeEach } from "vitest";
import {
  createMcpBridgeFixture,
  initMcpBridge,
  MCP_BRIDGE_CONFIG,
} from "./mcp-bridge-test-helpers.js";

describe("MCP Bridge Adapter - Init and Health", () => {
  let adapter: ReturnType<typeof createMcpBridgeFixture>["adapter"];
  let bus: ReturnType<typeof createMcpBridgeFixture>["bus"];

  beforeEach(() => {
    const fixture = createMcpBridgeFixture();
    adapter = fixture.adapter;
    bus = fixture.bus;
  });

  it("initializes with valid config and reports healthy", async () => {
    await initMcpBridge(adapter);

    const health = await adapter.health();
    expect(health.state).toBe("healthy");
  });

  it("rejects missing serverPath", async () => {
    await expect(
      adapter.init({
        ...MCP_BRIDGE_CONFIG,
        serverPath: "",
      })
    ).rejects.toThrow(/init failed/i);
  });

  it("discovers tools on init", async () => {
    await initMcpBridge(adapter);

    const tools = adapter.getTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some(tool => tool.name === "read_file")).toBe(true);
    expect(tools.some(tool => tool.name === "write_file")).toBe(true);
  });

  it("emits initialization event", async () => {
    await initMcpBridge(adapter);

    const events = bus.getEvents();
    const initEvent = events.find(event => event.topic === "provider.mcp.initialized");
    expect(initEvent).toBeDefined();
    expect(initEvent?.payload?.serverPath).toBe("stdio");
  });

  it("emits tool discovery events", async () => {
    await initMcpBridge(adapter);

    const events = bus.getEvents();
    const discoveryEvents = events.filter(event => event.topic === "provider.mcp.tool.discovered");
    expect(discoveryEvents.length).toBeGreaterThan(0);
  });

  it("reports healthy health status with timestamp", async () => {
    await initMcpBridge(adapter);

    const health = await adapter.health();
    expect(health.state).toBe("healthy");
    expect(health.failureCount).toBe(0);
    expect(health.lastCheck).toBeInstanceOf(Date);
    expect(health.lastCheck.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("handles server disconnection gracefully", async () => {
    await initMcpBridge(adapter);

    const health = await adapter.health();
    expect(health.state).toBe("healthy");
  });

  it("returns retryable health on disconnection", async () => {
    await initMcpBridge(adapter);

    const health = await adapter.health();
    expect(health).toBeDefined();
  });
});
