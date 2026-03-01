import type { AcpClientAdapter, AcpConfig, AcpExecuteResult, ProviderHealthState } from "./adapter";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;

interface PendingRequest {
  controller: AbortController;
  taskId: string;
}

export class AcpClient implements AcpClientAdapter {
  private config: AcpConfig | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private failureCount = 0;
  private consecutiveFailures = 0;

  async init(config: AcpConfig): Promise<void> {
    // Validate endpoint with a lightweight probe
    try {
      const response = await fetch(`${config.endpoint}/v1/messages`, {
        method: "OPTIONS",
        headers: {
          "x-api-key": config.apiKey,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok && response.status !== 405) {
        // 405 is expected for OPTIONS on some APIs, but at least the endpoint exists
        throw new Error(`Endpoint validation failed: ${response.status}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to validate ACP endpoint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.config = {
      model: config.model || DEFAULT_MODEL,
      timeoutMs: config.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries || DEFAULT_MAX_RETRIES,
      ...config,
    };
  }

  async execute(prompt: string, correlationId: string): Promise<AcpExecuteResult> {
    if (!this.config) {
      throw new Error("AcpClient not initialized. Call init() first.");
    }

    const taskId = `${correlationId}-${Date.now()}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

    this.pendingRequests.set(taskId, { controller, taskId });

    try {
      const response = await fetch(`${this.config.endpoint}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        if (response.status === 401) {
          this.consecutiveFailures++;
          throw new Error(JSON.stringify({
            code: "PROVIDER_AUTH_FAILED",
            message: "Authentication failed",
            status: 401,
          }));
        }
        if (response.status === 429) {
          this.consecutiveFailures++;
          throw new Error(JSON.stringify({
            code: "PROVIDER_RATE_LIMITED",
            message: "Rate limited",
            status: 429,
          }));
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const content = ((data.content as Record<string, unknown>[]) || [])[0];
      const text = (content?.text as string) || "";

      const usage = data.usage as Record<string, number> | undefined;

      this.consecutiveFailures = 0; // Reset on success
      this.pendingRequests.delete(taskId);

      return {
        taskId,
        content: text,
        model: this.config.model!,
        usage: usage
          ? { inputTokens: usage.input_tokens || 0, outputTokens: usage.output_tokens || 0 }
          : undefined,
      };
    } catch (error) {
      clearTimeout(timeoutHandle);
      this.pendingRequests.delete(taskId);
      this.consecutiveFailures++;

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(JSON.stringify({ code: "PROVIDER_TIMEOUT", message: "Request timeout" }));
        }
      }

      if (typeof error === "object" && error !== null && "code" in error) {
        throw new Error(JSON.stringify(error));
      }

      throw new Error(JSON.stringify({
        code: "PROVIDER_NETWORK_ERROR",
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async cancel(taskId: string): Promise<void> {
    const request = this.pendingRequests.get(taskId);
    if (request) {
      request.controller.abort();
      this.pendingRequests.delete(taskId);
    }
  }

  async health(): Promise<{ state: ProviderHealthState; failureCount: number }> {
    let state: ProviderHealthState = "healthy";

    if (this.consecutiveFailures >= 5) {
      state = "unavailable";
    } else if (this.consecutiveFailures >= 3) {
      state = "degraded";
    }

    return {
      state,
      failureCount: this.failureCount,
    };
  }

  async terminate(): Promise<void> {
    // Abort all pending requests
    for (const request of this.pendingRequests.values()) {
      request.controller.abort();
    }
    this.pendingRequests.clear();
    this.config = null;
    this.failureCount = 0;
    this.consecutiveFailures = 0;
  }
}
