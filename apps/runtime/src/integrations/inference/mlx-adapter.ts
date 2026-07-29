import type { InferenceRequest, InferenceResponse, ModelInfo } from "../../types/inference";
import type { InferenceEngine } from "./engine";
import { detectHardware } from "./hardware";

export class MlxInferenceEngine implements InferenceEngine {
  readonly id = "mlx";
  readonly name = "MLX (Apple Silicon)";
  readonly type = "local" as const;
  private modelPath: string;

  constructor(modelPath = "~/.cache/mlx-models/") {
    this.modelPath = modelPath;
  }

  async init(): Promise<void> {
    const hw = await detectHardware();
    if (!hw.hasAppleSilicon) {
      throw new Error("MLX requires Apple Silicon hardware");
    }
    // Verify mlx_lm is installed
    try {
      const proc = Bun.spawn(["python3", "-c", "import mlx_lm"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error("mlx_lm not installed. Run: pip install mlx-lm");
      }
    } catch (e) {
      throw new Error(`MLX initialization failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join("\n");
    const args = ["python3", "-m", "mlx_lm.generate", "--model", request.model, "--prompt", prompt];
    if (request.maxTokens) args.push("--max-tokens", String(request.maxTokens));

    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`MLX inference failed: ${stderr}`);
    }

    return {
      content: output.trim(),
      model: request.model,
      tokenUsage: { input: 0, output: 0 }, // MLX CLI doesn't report token counts
      finishReason: "end_turn",
    };
  }

  async *inferStream(request: InferenceRequest): AsyncIterable<string> {
    // Simplified: run inference and yield full result
    const response = await this.infer(request);
    yield response.content;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "mlx-community/Llama-3.2-3B-Instruct",
        name: "Llama 3.2 3B",
        contextWindow: 8192,
        providerId: "mlx",
      },
      {
        id: "mlx-community/Mistral-7B-Instruct-v0.3",
        name: "Mistral 7B",
        contextWindow: 32768,
        providerId: "mlx",
      },
    ];
  }

  async healthCheck(): Promise<"healthy" | "degraded" | "unavailable"> {
    const hw = await detectHardware();
    if (!hw.hasAppleSilicon) return "unavailable";
    try {
      const proc = Bun.spawn(["python3", "-c", "import mlx_lm"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      return exitCode === 0 ? "healthy" : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  async terminate(): Promise<void> {
    // No persistent process to terminate
  }
}
