import type { InferenceRequest, InferenceResponse, ModelInfo } from "../../types/inference";

export interface InferenceEngine {
  readonly id: string;
  readonly name: string;
  readonly type: "local" | "cloud" | "server";

  init(): Promise<void>;
  infer(request: InferenceRequest): Promise<InferenceResponse>;
  inferStream(request: InferenceRequest): AsyncIterable<string>;
  listModels(): Promise<ModelInfo[]>;
  healthCheck(): Promise<"healthy" | "degraded" | "unavailable">;
  terminate(): Promise<void>;
}
