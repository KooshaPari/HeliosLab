// wraps: ky 1.14.3
import ky, { type KyInstance } from "ky";
import type { InferenceRequest, InferenceResponse, ModelInfo } from "../../types/inference";
import type { InferenceEngine } from "./engine";

export class AnthropicInferenceEngine implements InferenceEngine {
  readonly id = "anthropic";
  readonly name = "Anthropic (Cloud)";
  readonly type = "cloud" as const;
  private endpoint: string;
  private apiKey: string;
  private client: KyInstance;

  constructor(apiKey?: string, endpoint = "https://api.anthropic.com") {
    this.apiKey = apiKey ?? process.env.HELIOS_ACP_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.endpoint = endpoint;
    this.client = ky.create({
      prefixUrl: endpoint,
      retry: { limit: 3, methods: ["post"], statusCodes: [429, 500, 502, 503, 504] },
      headers: {
        "anthropic-version": "2023-06-01",
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      },
    });
  }

  async init(): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        "Anthropic API key not configured. Set ANTHROPIC_API_KEY or HELIOS_ACP_API_KEY environment variable."
      );
    }
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    const data = await this.client
      .post("v1/messages", {
        json: {
          model: request.model || "claude-sonnet-4-20250514",
          max_tokens: request.maxTokens ?? 4096,
          messages: request.messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        },
      })
      .json<{
        content: Array<{ type: string; text: string }>;
        model: string;
        usage: { input_tokens: number; output_tokens: number };
        stop_reason: string;
      }>();

    const content = data.content
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join("");

    return {
      content,
      model: data.model,
      tokenUsage: {
        input: data.usage.input_tokens,
        output: data.usage.output_tokens,
      },
      finishReason: data.stop_reason === "end_turn" ? "end_turn" : "max_tokens",
    };
  }

  async *inferStream(request: InferenceRequest): AsyncIterable<string> {
    // Simplified: full response for now
    const response = await this.infer(request);
    yield response.content;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        contextWindow: 200000,
        providerId: "anthropic",
      },
      {
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        contextWindow: 200000,
        providerId: "anthropic",
      },
      {
        id: "claude-haiku-4-20250514",
        name: "Claude Haiku 4",
        contextWindow: 200000,
        providerId: "anthropic",
      },
    ];
  }

  async healthCheck(): Promise<"healthy" | "degraded" | "unavailable"> {
    if (!this.apiKey) return "unavailable";
    try {
      await this.client.post("v1/messages", {
        retry: 0,
        json: {
          model: "claude-haiku-4-20250514",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        },
      });
      return "healthy";
    } catch {
      return "unavailable";
    }
  }

  async terminate(): Promise<void> {}
}
