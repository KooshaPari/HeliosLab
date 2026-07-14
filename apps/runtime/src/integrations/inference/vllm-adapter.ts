// wraps: ky 1.14.3
import ky, { type KyInstance } from "ky";
import type { InferenceRequest, InferenceResponse, ModelInfo } from "../../types/inference";
import type { InferenceEngine } from "./engine";

export class VllmInferenceEngine implements InferenceEngine {
  readonly id = "vllm";
  readonly name = "vLLM (GPU Server)";
  readonly type = "server" as const;
  private endpoint: string;
  private client: KyInstance;

  constructor(endpoint = "http://localhost:8000", apiKey = "") {
    this.endpoint = endpoint;
    this.client = ky.create({
      prefixUrl: endpoint,
      retry: { limit: 3, methods: ["get", "post"], statusCodes: [429, 500, 502, 503, 504] },
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
  }

  async init(): Promise<void> {
    const health = await this.healthCheck();
    if (health === "unavailable") {
      throw new Error(`vLLM server at ${this.endpoint} is not reachable`);
    }
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    const data = await this.client
      .post("v1/chat/completions", {
        json: {
          model: request.model,
          messages: request.messages,
          max_tokens: request.maxTokens ?? 4096,
          stream: false,
        },
      })
      .json<{
        choices: Array<{ message: { content: string }; finish_reason: string }>;
        model: string;
        usage: { prompt_tokens: number; completion_tokens: number };
      }>();

    return {
      content: data.choices[0]?.message.content ?? "",
      model: data.model,
      tokenUsage: {
        input: data.usage.prompt_tokens,
        output: data.usage.completion_tokens,
      },
      finishReason: data.choices[0]?.finish_reason === "stop" ? "end_turn" : "max_tokens",
    };
  }

  async *inferStream(request: InferenceRequest): AsyncIterable<string> {
    const response = await this.infer(request);
    yield response.content;
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const data = await this.client.get("v1/models").json<{ data: Array<{ id: string }> }>();
      return data.data.map(m => ({
        id: m.id,
        name: m.id,
        contextWindow: 4096,
        providerId: "vllm",
      }));
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<"healthy" | "degraded" | "unavailable"> {
    try {
      await this.client.get("v1/models", { retry: 0, timeout: 3000 });
      return "healthy";
    } catch {
      return "unavailable";
    }
  }

  async terminate(): Promise<void> {}
}
