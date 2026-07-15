import { describe, expect, it, beforeEach } from "vitest";
import { createMcpBridgeFixture, initMcpBridge } from "./mcp-bridge-test-helpers.js";

describe("MCP Bridge Adapter - Sandboxing and Isolation", () => {
  let adapter: ReturnType<typeof createMcpBridgeFixture>["adapter"];

  beforeEach(async () => {
    const fixture = createMcpBridgeFixture();
    adapter = fixture.adapter;
    await initMcpBridge(adapter);
  });

  it("supports concurrent tool executions without interference", async () => {
    const results = await Promise.all([
      adapter.execute({ toolName: "read_file", arguments: { path: "/file1.txt" } }, "corr-1"),
      adapter.execute(
        { toolName: "write_file", arguments: { path: "/file2.txt", content: "test" } },
        "corr-2"
      ),
      adapter.execute({ toolName: "list_directory", arguments: { path: "/tmp" } }, "corr-3"),
    ]);

    expect(results).toHaveLength(3);
    results.forEach(result => {
      expect(result.isError).toBe(false);
    });
  });

  it("isolates tool execution failure from later calls", async () => {
    const success = await adapter.execute(
      { toolName: "read_file", arguments: { path: "/file.txt" } },
      "corr-1"
    );
    expect(success.isError).toBe(false);

    try {
      await adapter.execute({ toolName: "unknown_tool", arguments: {} }, "corr-2");
    } catch {
      // Expected
    }

    const success2 = await adapter.execute(
      { toolName: "list_directory", arguments: { path: "/tmp" } },
      "corr-3"
    );
    expect(success2.isError).toBe(false);
  });
});
