import { afterEach, describe, expect, it } from "bun:test";
import { VllmInferenceEngine } from "../../../../src/integrations/inference/vllm-adapter";

describe("VllmInferenceEngine", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should route model discovery through the configured endpoint", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async input => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      return new Response(JSON.stringify({ data: [{ id: "test-model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const engine = new VllmInferenceEngine("https://example.test/");
    const models = await engine.listModels();

    expect(requestedUrl).toBe("https://example.test/v1/models");
    expect(models).toEqual([
      {
        id: "test-model",
        name: "test-model",
        contextWindow: 4096,
        providerId: "vllm",
      },
    ]);
  });
});
