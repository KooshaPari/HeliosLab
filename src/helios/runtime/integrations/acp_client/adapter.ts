export interface AcpConfig {
  endpoint: string; // ACP API endpoint URL
  apiKey: string; // API key for authentication
  model?: string; // Model to use (default: "claude-sonnet-4-20250514")
  timeoutMs?: number; // Request timeout (default: 120000)
  maxRetries?: number; // Max retries (default: 2)
}

export interface AcpExecuteResult {
  taskId: string;
  content: string; // Response text
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export type ProviderHealthState = "healthy" | "degraded" | "unavailable";

export interface AcpClientAdapter {
  init(config: AcpConfig): Promise<void>;
  execute(prompt: string, correlationId: string): Promise<AcpExecuteResult>;
  cancel(taskId: string): Promise<void>;
  health(): Promise<{ state: ProviderHealthState; failureCount: number }>;
  terminate(): Promise<void>;
}
