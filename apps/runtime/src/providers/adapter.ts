/**
 * Provider Adapter Interface and Lifecycle
 *
 * Defines a typed interface for AI provider orchestration (ACP, MCP, A2A)
 * with common lifecycle methods (init, health, execute, terminate).
 *
 * FR-025-001: Typed adapter interface with lifecycle methods.
 */

/**
 * Health status of a provider.
 * Used by health() method to report current provider state.
 */
export interface ProviderHealthStatus {
  /** Current health state: healthy, degraded, or unavailable */
  state: "healthy" | "degraded" | "unavailable";
  /** Timestamp of last health check */
  lastCheck: Date;
  /** Count of consecutive failures */
  failureCount: number;
  /** Optional message explaining degraded/unavailable state */
  message?: string;
}

/**
 * Provider registration configuration.
 * Binds a provider adapter to a workspace with credentials, health policy, and limits.
 */
export interface ProviderRegistration<TConfig> {
  /** Unique provider identifier */
  id: string;
  /** Provider protocol type: ACP (Claude), MCP (tools), or A2A (agents) */
  type: "acp" | "mcp" | "a2a";
  /** Protocol-specific configuration (credentials, endpoints, etc.) */
  config: TConfig;
  /** Workspace ID this provider is bound to */
  workspaceId: string;
  /** Maximum concurrent execute calls allowed (1-100) */
  concurrencyLimit: number;
  /** Health check interval in milliseconds (minimum 5000) */
  healthCheckIntervalMs: number;
}

/**
 * Core adapter interface for provider orchestration.
 *
 * All providers (ACP, MCP, A2A) must implement this interface to be
 * registered and managed by the ProviderRegistry.
 *
 * Generic type parameters:
 * - TConfig: Protocol-specific configuration type
 * - TExecuteInput: Input type for execute method
 * - TExecuteOutput: Output type for execute method
 */
export interface ProviderAdapter<TConfig, TExecuteInput, TExecuteOutput> {
  /**
   * Initialize provider with validated configuration.
   *
   * FR-025-001: Lifecycle method for adapter initialization.
   * NFR-025-001: Must complete within 5 seconds or throw timeout error.
   *
   * @param config Validated provider configuration
   * @throws Normalized error if initialization fails
   */
  init(config: TConfig): Promise<void>;

  /**
   * Return current health status of the provider.
   *
   * FR-025-001: Lifecycle method for health monitoring.
   * FR-025-009: Health checks published to bus.
   *
   * @returns Current health status with state, timestamp, and failure count
   */
  health(): Promise<ProviderHealthStatus>;

  /**
   * Execute a task with mandatory correlation ID propagation.
   *
   * FR-025-001: Lifecycle method for task execution.
   * FR-025-002: Credentials must be bound per provider.
   * FR-025-011: Provider-specific errors must be normalized.
   *
   * @param input Protocol-specific task input
   * @param correlationId Correlation ID for bus message tracing
   * @returns Task result as per protocol
   * @throws Normalized error if execution fails
   */
  execute(input: TExecuteInput, correlationId: string): Promise<TExecuteOutput>;

  /**
   * Gracefully shutdown provider and release all resources.
   *
   * FR-025-001: Lifecycle method for resource cleanup.
   * NFR-025-004: Must not leak resources (child processes, file descriptors, memory).
   *
   * Cleanup includes:
   * - Child process termination
   * - File descriptor closure
   * - Memory release
   * - Credential cleanup
   *
   * @throws If cleanup fails (logged but not fatal to runtime)
   */
  terminate(): Promise<void>;
}

/**
 * Concrete adapter type aliases for common provider types.
 * Simplifies implementation and type inference for ACP, MCP, and A2A.
 */

/** ACP provider configuration input */
export interface ACPConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeout?: number;
}

/** ACP execute input */
export interface ACPExecuteInput {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

/** ACP execute output */
export interface ACPExecuteOutput {
  content: string;
  stopReason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** Type alias for ACP adapter implementation */
export type ACPAdapter = ProviderAdapter<ACPConfig, ACPExecuteInput, ACPExecuteOutput>;

/** MCP provider configuration input */
export interface MCPConfig {
  serverPath: string;
  args?: string[] | readonly string[];
  env?: Record<string, string>;
  timeout?: number;
}

/** MCP tool definition */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP execute input */
export interface MCPExecuteInput {
  toolName: string;
  arguments: Record<string, unknown>;
}

/** MCP execute output */
export interface MCPExecuteOutput {
  result: unknown;
  isError: boolean;
}

/** Type alias for MCP adapter implementation */
export type MCPAdapter = ProviderAdapter<MCPConfig, MCPExecuteInput, MCPExecuteOutput>;

/** A2A provider configuration input */
export interface A2AConfig {
  agentId: string;
  endpoint: string;
  apiKey?: string;
  timeout?: number;
}

/** A2A execute input */
export interface A2AExecuteInput {
  taskId: string;
  payload: Record<string, unknown>;
}

/** A2A execute output */
export interface A2AExecuteOutput {
  taskId: string;
  result: Record<string, unknown>;
  status: "success" | "failed" | "timeout";
}

/** Type alias for A2A adapter implementation */
export type A2AAdapter = ProviderAdapter<A2AConfig, A2AExecuteInput, A2AExecuteOutput>;

/**
 * Base adapter class for common lifecycle logic.
 *
 * Providers can extend this class to share implementation
 * of common patterns (health check scheduling, error handling, etc.).
 */
export abstract class BaseProviderAdapter<
  TConfig,
  TExecuteInput,
  TExecuteOutput,
> implements ProviderAdapter<TConfig, TExecuteInput, TExecuteOutput> {
  protected config: TConfig | null = null;
  protected healthStatus: ProviderHealthStatus = {
    state: "unavailable",
    lastCheck: new Date(),
    failureCount: 0,
  };

  abstract init(config: TConfig): Promise<void>;
  abstract health(): Promise<ProviderHealthStatus>;
  abstract execute(input: TExecuteInput, correlationId: string): Promise<TExecuteOutput>;
  abstract terminate(): Promise<void>;

  /**
   * Update health status after a check.
   * Protected helper for implementations.
   */
  protected updateHealthStatus(status: ProviderHealthStatus): void {
    this.healthStatus = { ...status, lastCheck: new Date() };
  }

  /**
   * Get current health status.
   * Protected helper for implementations.
   */
  protected getHealthStatus(): ProviderHealthStatus {
    return { ...this.healthStatus };
  }
}
