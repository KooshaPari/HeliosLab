import { describe, expect, test } from "bun:test";
import { InMemoryLocalBus } from "../protocol/bus.js";
import { MCPBridgeAdapter } from "./mcp-bridge.js";
import { NormalizedProviderError } from "./errors.js";

describe("MCPBridgeAdapter execution errors", () => {
  test("preserves an unknown tool error as a normalized provider error", async () => {
    const adapter = new MCPBridgeAdapter(new InMemoryLocalBus());
    await adapter.init({
      serverPath: "stdio",
      args: [],
      timeout: 30_000,
      healthCheckIntervalMs: 30_000,
    });

    const caught = await adapter
      .execute({ toolName: "nonexistent_tool", arguments: {} }, "corr-unknown-tool")
      .catch(error => error);

    expect(caught).toBeInstanceOf(NormalizedProviderError);
    const error = caught as NormalizedProviderError;
    expect(error.code).toBe("PROVIDER_EXECUTE_FAILED");
    expect(error.providerSource).toBe("mcp");
    expect(error.correlationId).toBe("corr-unknown-tool");
    expect(error.originalError?.message).toBe("Tool not found: nonexistent_tool");
  });
});
