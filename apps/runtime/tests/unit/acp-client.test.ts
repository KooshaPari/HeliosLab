/**
 * Regression coverage for ACP initialization error normalization.
 */

import { describe, expect, it } from "bun:test";
import { ACPClientAdapter } from "../../src/providers/acp-client.js";
import { NormalizedProviderError } from "../../src/providers/errors.js";

describe("ACPClientAdapter initialization", () => {
  it("normalizes an invalid endpoint through the ACP error boundary", async () => {
    const adapter = new ACPClientAdapter();

    await expect(
      adapter.init({
        baseUrl: "",
        apiKey: "acp-key",
        model: "claude-3-sonnet",
        timeout: 30000,
      })
    ).rejects.toBeInstanceOf(NormalizedProviderError);
  });
});
