import { afterEach, describe, expect, it } from "bun:test";
import { AnthropicInferenceEngine } from "../../../../src/integrations/inference/anthropic-adapter";

describe("AnthropicInferenceEngine", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should route inference requests through the configured endpoint", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async input => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "response" }],
          model: "test-model",
          usage: { input_tokens: 2, output_tokens: 1 },
          stop_reason: "end_turn",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const engine = new AnthropicInferenceEngine("test-key", "https://example.test/");
    const response = await engine.infer({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(requestedUrl).toBe("https://example.test/v1/messages");
    expect(response.content).toBe("response");
  });
});
