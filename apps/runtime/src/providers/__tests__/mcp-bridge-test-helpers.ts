import { InMemoryLocalBus } from "../../protocol/bus.js";
import { MCPBridgeAdapter } from "../mcp-bridge.js";

export const MCP_BRIDGE_CONFIG = {
  serverPath: "stdio",
  args: [] as string[],
  timeout: 30000,
  healthCheckIntervalMs: 30000,
} as const;

export function createMcpBridgeFixture() {
  const bus = new InMemoryLocalBus();
  const adapter = new MCPBridgeAdapter(bus);
  return { adapter, bus };
}

export async function initMcpBridge(adapter: MCPBridgeAdapter): Promise<void> {
  await adapter.init({
    ...MCP_BRIDGE_CONFIG,
    args: [...MCP_BRIDGE_CONFIG.args],
  });
}

export function getMcpToolEvents(bus: InMemoryLocalBus) {
  return bus.getEvents().filter(event => event.topic?.startsWith("provider.mcp.tool"));
}
