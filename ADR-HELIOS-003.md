# Architecture Decision Record: Provider Adapter Interface

**ADR-HELIOS-003**  
**Status:** Accepted  
**Date:** 2026-03-25  
**Author:** Phenotype Engineering  
**Stakeholders:** Runtime Team, AI/ML Team, Desktop Team

---

## Context

heliosApp requires AI inference capabilities across multiple backends:

1. **Cloud providers:** Anthropic (Claude), OpenAI (GPT-4), Google (Gemini)
2. **Local Apple Silicon:** MLX framework for on-device inference
3. **Local NVIDIA:** llama.cpp, vLLM for GPU-accelerated local inference
4. **Future protocols:** ACP, MCP, A2A for agent communication

Each provider has different:
- Authentication mechanisms (API keys, OAuth, local sockets)
- Request/response formats (JSON, streaming SSE, binary)
- Capabilities (tool use, vision, context window, streaming)
- Error semantics (rate limits, model unavailable, content policy)

Without abstraction, provider-specific code would permeate the codebase, creating:
- Vendor lock-in
- Inconsistent error handling
- Duplicated retry/failover logic
- Testing complexity

---

## Decision

We will implement a **unified Provider Adapter Interface** with the following design:

1. **Common interface:** All providers implement the same TypeScript interface
2. **Capability discovery:** Providers advertise supported features
3. **Streaming support:** All providers support token streaming via AsyncIterable
4. **Error normalization:** Provider errors map to common error taxonomy
5. **Health monitoring:** Built-in health checks with degrading state
6. **Credential isolation:** Each provider has isolated credential storage

### Provider System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Provider System                              │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    ProviderRouter                            │ │
│  │  - Route requests to appropriate provider                  │ │
│  │  - Failover on provider failure                            │ │
│  │  - Load balancing across healthy providers                 │ │
│  │  - Provider preference enforcement                         │ │
│  └──────────────────────────┬───────────────────────────────────┘ │
│                             │                                     │
│  ┌──────────────────────────┼───────────────────────────────────┐│
│  │                     ProviderRegistry                         ││
│  │  ┌────────────┬─────────┴──────────┬────────────┐         ││
│  │  │            │                     │            │         ││
│  │  ▼            ▼                     ▼            ▼         ││
│  │ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         ││
│  │ │Anthropic│ │  MLX    │ │llama.cpp│ │  A2A    │         ││
│  │ │ Adapter │ │ Adapter │ │ Adapter │ │ Adapter │         ││
│  │ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘         ││
│  │      │           │           │           │              ││
│  │      │           │           │           │              ││
│  │  ┌───┴───┐   ┌───┴───┐   ┌───┴───┐   ┌───┴───┐         ││
│  │  │HTTP/  │   │Process│   │Process│   │HTTP/  │         ││
│  │  │Stream │   │Bridge │   │Bridge │   │gRPC   │         ││
│  │  └───────┘   └───────┘   └───────┘   └───────┘         ││
│  └───────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌───────────────────────────────────────────────────────────┐│
│  │                   Credential Store                        ││
│  │  - Encrypted at rest                                      ││
│  │  - Per-provider isolation                                 ││
│  │  - Scoped to workspace                                    ││
│  │  - Audit log for access                                   ││
│  └───────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

### Provider Adapter Interface

```typescript
// apps/runtime/src/providers/types.ts

/**
 * Base interface for all AI inference providers
 */
export interface ProviderAdapter {
  /** Provider identifier (anthropic, mlx, llamacpp, etc.) */
  readonly id: string;
  
  /** Provider display name */
  readonly name: string;
  
  /** Provider version */
  readonly version: string;
  
  /**
   * Initialize the provider with configuration
   * @throws ProviderInitializationError if setup fails
   */
  initialize(config: ProviderConfig): Promise<void>;
  
  /**
   * Get provider capabilities
   */
  getCapabilities(): ProviderCapabilities;
  
  /**
   * Check provider health
   */
  health(): Promise<HealthStatus>;
  
  /**
   * Generate a non-streaming response
   */
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  
  /**
   * Generate a streaming response
   */
  stream(request: StreamRequest): AsyncIterable<StreamChunk>;
  
  /**
   * Get available models from this provider
   */
  listModels(): Promise<ModelInfo[]>;
  
  /**
   * Cancel an in-progress request
   */
  cancel(requestId: string): Promise<void>;
  
  /**
   * Clean up resources
   */
  dispose(): Promise<void>;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Provider-specific settings */
  settings: Record<string, unknown>;
  
  /** Credential reference (not the actual credential) */
  credentialId: string;
  
  /** Workspace scope */
  workspaceId: string;
  
  /** Request timeout in milliseconds */
  timeout: number;
  
  /** Retry configuration */
  retry: RetryConfig;
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  /** Supports streaming responses */
  streaming: boolean;
  
  /** Supports tool/function calling */
  toolUse: boolean;
  
  /** Supports vision/multimodal inputs */
  vision: boolean;
  
  /** Maximum context window (tokens) */
  maxContextWindow: number;
  
  /** Supported models */
  models: ModelCapability[];
  
  /** Execution location */
  executionLocation: 'cloud' | 'local_gpu' | 'local_cpu';
  
  /** Requires network connectivity */
  requiresNetwork: boolean;
}

export interface ModelCapability {
  id: string;
  name: string;
  contextWindow: number;
  supportsToolUse: boolean;
  supportsVision: boolean;
}

/**
 * Generate request (non-streaming)
 */
export interface GenerateRequest {
  /** Request ID for correlation */
  requestId: string;
  
  /** Conversation ID */
  conversationId: string;
  
  /** Model to use */
  model: string;
  
  /** Message history */
  messages: Message[];
  
  /** Available tools */
  tools?: ToolDefinition[];
  
  /** Generation parameters */
  parameters: GenerationParameters;
  
  /** Lane context for isolation */
  laneId?: string;
}

export interface StreamRequest extends GenerateRequest {
  /** Enable token streaming */
  stream: true;
}

export interface GenerationParameters {
  temperature: number;
  maxTokens: number;
  topP?: number;
  stopSequences?: string[];
}

/**
 * Non-streaming response
 */
export interface GenerateResponse {
  requestId: string;
  
  /** Generated content */
  content: string;
  
  /** Tool calls made by the model */
  toolCalls?: ToolCall[];
  
  /** Token usage statistics */
  usage: TokenUsage;
  
  /** Model that generated the response */
  model: string;
  
  /** Provider-specific metadata */
  metadata: Record<string, unknown>;
  
  /** Finish reason */
  finishReason: 'stop' | 'max_tokens' | 'tool_calls' | 'error';
}

/**
 * Streaming chunk
 */
export interface StreamChunk {
  requestId: string;
  
  /** Chunk type */
  type: 'content' | 'tool_call' | 'error' | 'done';
  
  /** Content delta (for content type) */
  delta?: string;
  
  /** Complete tool call (for tool_call type) */
  toolCall?: ToolCall;
  
  /** Error details (for error type) */
  error?: ProviderError;
  
  /** Usage stats (usually in final chunk) */
  usage?: TokenUsage;
}

/**
 * Tool definitions
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Health status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  lastChecked: number;
  message?: string;
}

/**
 * Normalized provider error
 */
export interface ProviderError {
  /** Error code from taxonomy */
  code: ProviderErrorCode;
  
  /** Human-readable message */
  message: string;
  
  /** Whether request can be retried */
  retryable: boolean;
  
  /** Retry after (seconds) */
  retryAfter?: number;
  
  /** Provider-specific error details */
  details?: Record<string, unknown>;
}

export type ProviderErrorCode =
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMITED'
  | 'MODEL_UNAVAILABLE'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'CONTENT_POLICY_VIOLATION'
  | 'INSUFFICIENT_QUOTA'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN_ERROR';
```

### Anthropic Adapter Implementation

```typescript
// apps/runtime/src/providers/adapters/anthropic.ts

import { Anthropic } from '@anthropic-ai/sdk';

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  readonly version = '2024-01';
  
  private client: Anthropic | null = null;
  private config: ProviderConfig | null = null;
  
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    
    const credential = await credentialStore.get(config.credentialId);
    
    this.client = new Anthropic({
      apiKey: credential.apiKey,
      baseURL: config.settings.baseUrl as string | undefined,
      timeout: config.timeout,
    });
    
    // Validate connection
    await this.health();
  }
  
  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: true,
      vision: true,
      maxContextWindow: 200_000,
      models: [
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', contextWindow: 200_000, supportsToolUse: true, supportsVision: true },
        { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', contextWindow: 200_000, supportsToolUse: true, supportsVision: true },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', contextWindow: 200_000, supportsToolUse: true, supportsVision: true },
      ],
      executionLocation: 'cloud',
      requiresNetwork: true,
    };
  }
  
  async health(): Promise<HealthStatus> {
    if (!this.client) {
      return {
        status: 'unhealthy',
        latency: 0,
        lastChecked: Date.now(),
        message: 'Client not initialized',
      };
    }
    
    const start = performance.now();
    try {
      // Lightweight health check - list models
      await this.client.models.list({ limit: 1 });
      
      return {
        status: 'healthy',
        latency: performance.now() - start,
        lastChecked: Date.now(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: performance.now() - start,
        lastChecked: Date.now(),
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    if (!this.client) {
      throw new ProviderInitializationError('Anthropic client not initialized');
    }
    
    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.parameters.maxTokens,
        temperature: request.parameters.temperature,
        messages: this.convertMessages(request.messages),
        tools: request.tools?.map(this.convertTool),
        stream: false,
      });
      
      return this.convertResponse(request.requestId, response);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }
  
  async *stream(request: StreamRequest): AsyncIterable<StreamChunk> {
    if (!this.client) {
      throw new ProviderInitializationError('Anthropic client not initialized');
    }
    
    try {
      const stream = await this.client.messages.create({
        model: request.model,
        max_tokens: request.parameters.maxTokens,
        temperature: request.parameters.temperature,
        messages: this.convertMessages(request.messages),
        tools: request.tools?.map(this.convertTool),
        stream: true,
      });
      
      for await (const event of stream) {
        yield this.convertStreamChunk(request.requestId, event);
      }
    } catch (error) {
      yield {
        requestId: request.requestId,
        type: 'error',
        error: this.normalizeError(error),
      };
    }
  }
  
  async listModels(): Promise<ModelInfo[]> {
    return this.getCapabilities().models.map(m => ({
      id: m.id,
      name: m.name,
      provider: this.id,
      capabilities: m,
    }));
  }
  
  async cancel(requestId: string): Promise<void> {
    // Anthropic doesn't support request cancellation after submission
    // Log for audit purposes
    logger.info({ requestId }, 'Attempted to cancel Anthropic request (not supported)');
  }
  
  async dispose(): Promise<void> {
    this.client = null;
    this.config = null;
  }
  
  // Private helpers
  
  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
  }
  
  private convertTool(tool: ToolDefinition): Anthropic.Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    };
  }
  
  private convertResponse(
    requestId: string,
    response: Anthropic.Message
  ): GenerateResponse {
    const content = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');
    
    const toolCalls = response.content
      .filter(c => c.type === 'tool_use')
      .map(c => ({
        id: c.id,
        name: c.name,
        arguments: c.input as Record<string, unknown>,
      }));
    
    return {
      requestId,
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      metadata: { stop_reason: response.stop_reason },
      finishReason: this.convertFinishReason(response.stop_reason),
    };
  }
  
  private convertStreamChunk(
    requestId: string,
    event: Anthropic.MessageStreamEvent
  ): StreamChunk {
    switch (event.type) {
      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          return {
            requestId,
            type: 'content',
            delta: event.delta.text,
          };
        }
        break;
        
      case 'content_block_stop':
        if (event.content_block.type === 'tool_use') {
          return {
            requestId,
            type: 'tool_call',
            toolCall: {
              id: event.content_block.id,
              name: event.content_block.name,
              arguments: event.content_block.input as Record<string, unknown>,
            },
          };
        }
        break;
        
      case 'message_stop':
        return {
          requestId,
          type: 'done',
        };
    }
    
    // Default: skip this event
    return { requestId, type: 'content', delta: '' };
  }
  
  private convertFinishReason(reason: string | null): GenerateResponse['finishReason'] {
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'max_tokens': return 'max_tokens';
      case 'tool_use': return 'tool_calls';
      default: return 'error';
    }
  }
  
  private normalizeError(error: unknown): ProviderError {
    if (error instanceof Anthropic.APIError) {
      switch (error.status) {
        case 401:
          return {
            code: 'AUTHENTICATION_ERROR',
            message: 'Invalid API key',
            retryable: false,
          };
        case 429:
          return {
            code: 'RATE_LIMITED',
            message: 'Rate limit exceeded',
            retryable: true,
            retryAfter: parseInt(error.headers?.['retry-after'] || '60'),
          };
        case 529:
          return {
            code: 'MODEL_UNAVAILABLE',
            message: 'Model is temporarily unavailable',
            retryable: true,
            retryAfter: 30,
          };
        case 413:
          return {
            code: 'CONTEXT_LENGTH_EXCEEDED',
            message: 'Request exceeds maximum context length',
            retryable: false,
          };
        default:
          return {
            code: 'INTERNAL_ERROR',
            message: error.message,
            retryable: error.status >= 500,
          };
      }
    }
    
    if (error instanceof Anthropic.AnthropicError) {
      return {
        code: 'INTERNAL_ERROR',
        message: error.message,
        retryable: false,
      };
    }
    
    return {
      code: 'UNKNOWN_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
      retryable: false,
    };
  }
}
```

### MLX Adapter (Apple Silicon Local)

```typescript
// apps/runtime/src/providers/adapters/mlx.ts

import { spawn } from 'bun';

export class MLXAdapter implements ProviderAdapter {
  readonly id = 'mlx';
  readonly name = 'MLX (Apple Silicon)';
  readonly version = '1.0';
  
  private process: Subprocess | null = null;
  private config: ProviderConfig | null = null;
  private modelPath: string | null = null;
  
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    
    // Validate we're on Apple Silicon
    if (process.platform !== 'darwin') {
      throw new ProviderInitializationError('MLX only available on macOS');
    }
    
    // Validate MLX is installed
    try {
      await $`python3 -c "import mlx_lm"`.quiet();
    } catch {
      throw new ProviderInitializationError(
        'MLX not installed. Run: pip install mlx-lm'
      );
    }
    
    // Download/load model if needed
    this.modelPath = await this.ensureModel(config.settings.model as string);
    
    // Start MLX server process
    this.process = spawn({
      cmd: [
        'python3', '-m', 'mlx_lm.server',
        '--model', this.modelPath,
        '--port', String(config.settings.port || 8080),
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    
    // Wait for server to be ready
    await this.waitForServer();
  }
  
  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolUse: false, // MLX doesn't support tool use yet
      vision: false,
      maxContextWindow: 32_768, // Model dependent
      models: [
        { id: 'mlx-community/Llama-3.2-3B-Instruct-4bit', name: 'Llama 3.2 3B (4-bit)', contextWindow: 128_000, supportsToolUse: false, supportsVision: false },
        { id: 'mlx-community/Mistral-7B-Instruct-v0.3-4bit', name: 'Mistral 7B (4-bit)', contextWindow: 32_768, supportsToolUse: false, supportsVision: false },
      ],
      executionLocation: 'local_gpu',
      requiresNetwork: false,
    };
  }
  
  async health(): Promise<HealthStatus> {
    if (!this.process) {
      return {
        status: 'unhealthy',
        latency: 0,
        lastChecked: Date.now(),
        message: 'Server not running',
      };
    }
    
    const start = performance.now();
    try {
      const response = await fetch(`http://localhost:${this.config?.settings.port}/health`);
      
      return {
        status: response.ok ? 'healthy' : 'degraded',
        latency: performance.now() - start,
        lastChecked: Date.now(),
      };
    } catch {
      return {
        status: 'unhealthy',
        latency: performance.now() - start,
        lastChecked: Date.now(),
        message: 'Server not responding',
      };
    }
  }
  
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const response = await fetch(`http://localhost:${this.config?.settings.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.parameters.maxTokens,
        temperature: request.parameters.temperature,
        stream: false,
      }),
    });
    
    if (!response.ok) {
      throw new ProviderError('MLX request failed', { status: response.status });
    }
    
    const data = await response.json();
    
    return {
      requestId: request.requestId,
      content: data.choices[0].message.content,
      usage: data.usage,
      model: request.model,
      metadata: {},
      finishReason: data.choices[0].finish_reason,
    };
  }
  
  async *stream(request: StreamRequest): AsyncIterable<StreamChunk> {
    const response = await fetch(`http://localhost:${this.config?.settings.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.parameters.maxTokens,
        temperature: request.parameters.temperature,
        stream: true,
      }),
    });
    
    if (!response.ok) {
      yield {
        requestId: request.requestId,
        type: 'error',
        error: {
          code: 'INTERNAL_ERROR',
          message: `MLX server error: ${response.status}`,
          retryable: false,
        },
      };
      return;
    }
    
    const reader = response.body?.getReader();
    if (!reader) {
      yield {
        requestId: request.requestId,
        type: 'error',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'No response body',
          retryable: false,
        },
      };
      return;
    }
    
    // Parse SSE stream
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { requestId: request.requestId, type: 'done' };
            return;
          }
          
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta?.content || '';
            
            yield {
              requestId: request.requestId,
              type: 'content',
              delta,
            };
          } catch {
            // Skip malformed lines
          }
        }
      }
    }
  }
  
  async listModels(): Promise<ModelInfo[]> {
    return this.getCapabilities().models.map(m => ({
      id: m.id,
      name: m.name,
      provider: this.id,
      capabilities: m,
    }));
  }
  
  async cancel(requestId: string): Promise<void> {
    // Cancel by dropping the stream
    logger.info({ requestId }, 'Cancelled MLX request');
  }
  
  async dispose(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.config = null;
    this.modelPath = null;
  }
  
  private async ensureModel(modelId: string): Promise<string> {
    // Download from HuggingFace if not cached
    const cacheDir = `${process.env.HOME}/.cache/mlx_models`;
    const modelPath = `${cacheDir}/${modelId.replace('/', '--')}`;
    
    if (await exists(modelPath)) {
      return modelPath;
    }
    
    // Download
    await $`huggingface-cli download ${modelId} --local-dir ${modelPath}`.quiet();
    
    return modelPath;
  }
  
  private async waitForServer(): Promise<void> {
    const port = this.config?.settings.port || 8080;
    const deadline = Date.now() + 30000; // 30 second timeout
    
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (response.ok) return;
      } catch {
        // Server not ready yet
      }
      await new Promise(r => setTimeout(r, 100));
    }
    
    throw new ProviderInitializationError('MLX server failed to start');
  }
}
```

### Provider Router

```typescript
// apps/runtime/src/providers/router.ts

export class ProviderRouter {
  private providers = new Map<string, ProviderAdapter>();
  private healthStatuses = new Map<string, HealthStatus>();
  private preferences: ProviderPreferences;
  
  constructor(preferences: ProviderPreferences) {
    this.preferences = preferences;
    this.startHealthChecks();
  }
  
  registerProvider(adapter: ProviderAdapter): void {
    this.providers.set(adapter.id, adapter);
  }
  
  async route(request: GenerateRequest): Promise<GenerateResponse> {
    const provider = this.selectProvider(request);
    
    try {
      return await provider.generate(request);
    } catch (error) {
      if (error instanceof ProviderError && error.retryable) {
        // Try failover
        return this.failover(request, provider.id);
      }
      throw error;
    }
  }
  
  async *stream(request: StreamRequest): AsyncIterable<StreamChunk> {
    const provider = this.selectProvider(request);
    
    try {
      yield* provider.stream(request);
    } catch (error) {
      if (error instanceof ProviderError && error.retryable) {
        // Emit error and try failover
        yield {
          requestId: request.requestId,
          type: 'error',
          error: {
            code: 'FAILOVER',
            message: `Primary provider failed, attempting failover`,
            retryable: true,
          },
        };
        
        const failover = this.selectFailover(request, provider.id);
        yield* failover.stream(request);
      } else {
        throw error;
      }
    }
  }
  
  private selectProvider(request: GenerateRequest): ProviderAdapter {
    // Check user preference
    const preferredId = this.preferences.getPreference(request.laneId);
    
    if (preferredId) {
      const preferred = this.providers.get(preferredId);
      if (preferred && this.isHealthy(preferred)) {
        return preferred;
      }
    }
    
    // Auto-select based on requirements
    const candidates = Array.from(this.providers.values())
      .filter(p => this.isHealthy(p))
      .filter(p => this.supportsRequest(p, request));
    
    // Prefer local providers for simple requests
    if (!request.tools?.length && candidates.some(c => !c.getCapabilities().requiresNetwork)) {
      return candidates.find(c => !c.getCapabilities().requiresNetwork)!;
    }
    
    // Fall back to first available
    if (candidates.length > 0) {
      return candidates[0];
    }
    
    throw new ProviderError('No healthy providers available', {
      code: 'NO_PROVIDERS',
      retryable: false,
    });
  }
  
  private selectFailover(
    request: GenerateRequest,
    failedId: string
  ): ProviderAdapter {
    const candidates = Array.from(this.providers.values())
      .filter(p => p.id !== failedId)
      .filter(p => this.isHealthy(p))
      .filter(p => this.supportsRequest(p, request));
    
    if (candidates.length === 0) {
      throw new ProviderError('No failover providers available', {
        code: 'NO_FAILOVER',
        retryable: false,
      });
    }
    
    return candidates[0];
  }
  
  private isHealthy(provider: ProviderAdapter): boolean {
    const status = this.healthStatuses.get(provider.id);
    return status?.status === 'healthy' || status?.status === 'degraded';
  }
  
  private supportsRequest(provider: ProviderAdapter, request: GenerateRequest): boolean {
    const caps = provider.getCapabilities();
    
    // Check tool use requirement
    if (request.tools?.length && !caps.toolUse) {
      return false;
    }
    
    // Check model availability
    if (!caps.models.some(m => m.id === request.model)) {
      return false;
    }
    
    return true;
  }
  
  private startHealthChecks(): void {
    // Run health checks every 30 seconds
    setInterval(async () => {
      for (const [id, provider] of this.providers) {
        try {
          const status = await provider.health();
          this.healthStatuses.set(id, status);
        } catch (error) {
          this.healthStatuses.set(id, {
            status: 'unhealthy',
            latency: 0,
            lastChecked: Date.now(),
            message: error instanceof Error ? error.message : 'Health check failed',
          });
        }
      }
    }, 30000);
  }
}
```

---

## Consequences

### Positive

1. **Provider independence:** Switch providers without changing application code
2. **Consistent interface:** Same code path for cloud and local inference
3. **Failover support:** Automatic fallback when providers fail
4. **Testability:** Mock providers for testing without API calls
5. **Health monitoring:** Built-in provider health tracking
6. **Type safety:** Full TypeScript types throughout

### Negative

1. **Lowest common denominator:** Some provider features may not be exposed
2. **Adapter maintenance:** Each provider needs adapter implementation
3. **Feature lag:** New provider features require adapter updates
4. **Complexity:** More abstraction layers than direct API calls

### Neutral

1. **Credential management:** Per-provider storage required
2. **Error mapping:** Must maintain error taxonomy mappings

---

## Alternatives Considered

### Alternative 1: Direct API Integration

**Approach:** Use provider SDKs directly in application code.

**Rejected because:**
- Creates vendor lock-in
- Inconsistent error handling
- Duplicated retry logic
- Harder to test

### Alternative 2: OpenRouter-style Gateway

**Approach:** Use a single API (OpenRouter) that proxies to multiple providers.

**Rejected because:**
- Requires third-party dependency
- Local inference (MLX, llama.cpp) wouldn't fit
- Less control over routing logic
- Additional latency and cost

### Alternative 3: LangChain/LlamaIndex

**Approach:** Use existing abstraction libraries.

**Rejected because:**
- Heavy dependencies
- Python-centric (LangChain)
- More abstraction than needed
- Less control over specifics

---

## Related Decisions

- ADR-HELIOS-001: LocalBus V1 Protocol (provider events)
- ADR-HELIOS-002: State Machine Architecture
- SPEC.md: Provider interface definition

---

## Performance Characteristics

| Metric | Cloud Provider | Local Provider |
|--------|----------------|----------------|
| Initialization | 500ms | 5-30s (model load) |
| Health check | 200ms | 50ms |
| First token latency | 500-2000ms | 50-200ms |
| Streaming throughput | Network bound | GPU memory bound |

---

## Testing Strategy

```typescript
// apps/runtime/src/providers/__tests__/router.test.ts

describe('ProviderRouter', () => {
  test('selects preferred provider when healthy', async () => {
    const mockAnthropic = createMockProvider({
      id: 'anthropic',
      healthy: true,
    });
    
    const mockMLX = createMockProvider({
      id: 'mlx',
      healthy: true,
    });
    
    const router = new ProviderRouter({
      getPreference: () => 'anthropic',
    });
    
    router.registerProvider(mockAnthropic);
    router.registerProvider(mockMLX);
    
    const request = createTestRequest({ laneId: 'ln_123' });
    const provider = router.selectProvider(request);
    
    expect(provider.id).toBe('anthropic');
  });
  
  test('fails over when primary fails', async () => {
    const failingProvider = createMockProvider({
      id: 'anthropic',
      healthy: true,
      generate: () => { throw new ProviderError('fail', { code: 'NETWORK_ERROR', retryable: true }); },
    });
    
    const backupProvider = createMockProvider({
      id: 'mlx',
      healthy: true,
    });
    
    const router = new ProviderRouter({ getPreference: () => 'anthropic' });
    router.registerProvider(failingProvider);
    router.registerProvider(backupProvider);
    
    const request = createTestRequest();
    const response = await router.route(request);
    
    expect(backupProvider.generate).toHaveBeenCalled();
  });
  
  test('prefers local provider for simple requests', async () => {
    const cloudProvider = createMockProvider({
      id: 'anthropic',
      requiresNetwork: true,
      healthy: true,
    });
    
    const localProvider = createMockProvider({
      id: 'mlx',
      requiresNetwork: false,
      healthy: true,
    });
    
    const router = new ProviderRouter({ getPreference: () => null });
    router.registerProvider(cloudProvider);
    router.registerProvider(localProvider);
    
    // Simple request without tools
    const request = createTestRequest({ tools: [] });
    const provider = router.selectProvider(request);
    
    expect(provider.id).toBe('mlx');
  });
});
```

---

## References

1. Anthropic API docs: https://docs.anthropic.com
2. MLX documentation: https://ml-explore.github.io/mlx-python/
3. llama.cpp server: https://github.com/ggerganov/llama.cpp/blob/master/examples/server/README.md
4. "Designing Data-Intensive Applications" - Martin Kleppmann (Chapter 1: Reliable, Scalable, Maintainable)

---

## Notes

- Provider adapters are loaded dynamically based on configuration
- Local providers (MLX, llama.cpp) use subprocess spawning with Bun
- Health checks run every 30 seconds; providers marked unhealthy after 3 consecutive failures
- Provider preference can be set per lane, workspace, or globally
