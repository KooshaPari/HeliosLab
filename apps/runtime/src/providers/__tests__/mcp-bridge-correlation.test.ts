import { beforeEach, describe, expect, it } from "vitest";
import {
	createMcpBridgeFixture,
	getMcpToolEvents,
	initMcpBridge,
} from "./mcp-bridge-test-helpers.js";

describe("MCP Bridge Adapter - Correlation IDs", () => {
	let adapter: ReturnType<typeof createMcpBridgeFixture>["adapter"];
	let bus: ReturnType<typeof createMcpBridgeFixture>["bus"];

	beforeEach(async () => {
		const fixture = createMcpBridgeFixture();
		adapter = fixture.adapter;
		bus = fixture.bus;
		await initMcpBridge(adapter);
	});

	it("includes correlation ID in all tool-related bus events", async () => {
		const correlationId = "unique-trace-id";

		await adapter.execute(
			{
				toolName: "read_file",
				arguments: { path: "/tmp/test.txt" },
			},
			correlationId,
		);

		// Discovery happens at init, where there is no execution to correlate
		// with, so only the events this call emits are asserted on.
		const toolEvents = getMcpToolEvents(bus).filter(
			(event) => event.topic !== "provider.mcp.tool.discovered",
		);
		toolEvents.forEach((event) => {
			expect(event.payload?.correlationId).toBe(correlationId);
		});
	});
});
