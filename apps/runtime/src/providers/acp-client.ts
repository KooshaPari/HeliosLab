/**
 * ACP Client Boundary Adapter
 *
 * Implements the ACP protocol client adapter for Claude/agent task execution
 * with full run/cancel lifecycle, policy gate integration, and health monitoring.
 *
 * FR-025-003: ACP integration with run/cancel lifecycle and bus correlation.
 * FR-025-012: Policy gate pre-execute hook.
 * FR-025-009: Health checks with configurable intervals.
 */

import type { LocalBus } from "../protocol/bus.js";
import type {
  ProviderAdapter,
  ProviderHealthStatus,
  ACPConfig,
  ACPExecuteInput,
  ACPExecuteOutput,
} from "./adapter.js";


/**
 * Policy gate interface for access control.
 * Blocks unauthorized provider actions before contacting external endpoints.
 */
export interface PolicyGate {
  evaluate(
    action: string,
    context: Record<string, unknown>
  ): Promise<{
    allowed: boolean;
    reason?: string;
  }>;
}

/**
 * Default pass-through policy gate (allow all).
 * Used until spec 023 delivers the real policy engine.
 */
class DefaultPolicyGate implements PolicyGate {
  async evaluate(): Promise<{ allowed: boolean }> {
    return { allowed: true };
  }
}

/**
 * Mock ACP request for testing/prototyping.
 */
interface ACPRequest {
  correlationId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Mock ACP response.
 */
interface ACPResponse {
  taskId: string;
  content: string;
  stopReason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * ACP Client Adapter
 *
 * Manages Claude task execution via the ACP protocol with:
 * - Run/cancel lifecycle
 * - Correlation ID propagation
 * - Policy gate integration
 * - Health monitoring
 * - Bus event publishing
 *
 * FR-025-003: ACP protocol client for Claude.
 */
export class ACPClientAdapter implements ProviderAdapter<
  ACPConfig,
  ACPExecuteInput,
  ACPExecuteOutput
> {
  private config: ACPConfig | null = null;
  private bus: LocalBus | null = null;
  private policyGate: PolicyGate;
  private healthStatus: ProviderHealthStatus = {
    state: "unavailable",
    lastCheck: new Date(),
    failureCount: 0,
  };
  private inFlightTasks = new Map<string, AbortController>();
  private lastHealthCheckTime = 0;
  private healthCheckInterval = 30000; // Default 30s

  constructor(bus?: LocalBus, policyGate?: PolicyGate) {
    this.bus = bus || null;
    this.policyGate = policyGate || new DefaultPolicyGate();
  }

  /**
   * Initialize ACP client with configuration.
   *
   * FR-025-003: ACP client initialization.
   * NFR-025-001: Must complete within 5 seconds.
   *
   * @param config ACP configuration
   * @throws NormalizedProviderError if init fails
   */
  async init(config: ACPConfig): Promise<void> {
    const _startTime = Date.now();

    try {
      // Validate config
      if (!config.baseUrl || typeof config.baseUrl !== "string") {
        throw new Error("Missing or invalid endpoint");
      }

      if (!config.apiKey || typeof config.apiKey !== "string") {
        throw new Error("Missing or invalid apiKeyRef");
      }

      if (!config.model || typeof config.model !== "string") {
        throw new Error("Missing or invalid model");
      }

      // Validate timeout
      if (config.timeout && config.timeout < 1000) {
        throw new Error("timeout must be >= 1000ms");
      }

      // Simulate endpoint reachability check with timeout
      const _probeTimeout = config.timeout || 10000;
      const probeResult = await Promise.race([
        this.probeEndpoint(config.baseUrl),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("Probe timeout")), 2000)
        ),
      ]);

      if (!probeResult) {
        throw new Error("Endpoint unreachable");
      }

      this.config = config;
      this.healthCheckInterval = 30000;

      this.healthStatus = {
        state: "healthy",
        lastCheck: new Date(),
        failureCount: 0,
      };

      const elapsed = Date.now() - startTime;
      if (elapsed > 5000) {
        throw new Error(`Init exceeded 5s timeout (${elapsed}ms)`);
      }

      await this.publishEvent("provider.acp.initialized", {
        endpoint: config.baseUrl,
        model: config.model,
      });
    } catch {
      const normalized = normalizeError(error, "acp");

      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        `ACP client init failed: ${normalized.message}`,
        "acp",
        false
      );
    }
  }

  /**
   * Get current health status.
   *
   * FR-025-009: Health monitoring with state transitions.
   *
   * @returns Current health status
   */
  async health(): Promise<ProviderHealthStatus> {
    if (!this.config) {
      return {
        state: "unavailable",
        lastCheck: new Date(),
        failureCount: 0,
        message: "Not initialized",
      };
    }

    try {
      // Perform lightweight health check
      const probeSuccess = await Promise.race([
        this.probeEndpoint(this.config.baseUrl ?? ""),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), 5000)
        ),
      ]);

      if (probeSuccess) {
        // Reset failure count on success
        const previousState = this.healthStatus.state;
        this.healthStatus = {
          state: "healthy",
          lastCheck: new Date(),
          failureCount: 0,
        };

        // Publish state transition event
        if (previousState !== "healthy") {
          await this.publishEvent("provider.acp.health.changed", {
            previousState,
            newState: "healthy",
            failureCount: 0,
          });
        }

        return { ...this.healthStatus };
      }
    } catch {
      // Increment failure count
      this.healthStatus.failureCount++;

      // Transition to degraded/unavailable
      let newState: "healthy" | "degraded" | "unavailable" = this.healthStatus.state;

      if (this.healthStatus.failureCount >= 5) {
        newState = "unavailable";
      } else if (this.healthStatus.failureCount >= 3) {
        newState = "degraded";
      }

      const previousState = this.healthStatus.state;
      this.healthStatus = {
        state: newState,
        lastCheck: new Date(),
        failureCount: this.healthStatus.failureCount,
        message: `Health check failed: ${normalizeError(error, "acp").message}`,
      };

      // Publish state transition event
      if (previousState !== newState) {
        await this.publishEvent("provider.acp.health.changed", {
          previousState,
          newState,
          failureCount: this.healthStatus.failureCount,
        });
      }
    }

    return { ...this.healthStatus };
  }

  /**
   * Execute a task via ACP.
   *
   * FR-025-003: Task execution with correlation ID.
   * FR-025-012: Policy gate integration.
   *
   * @param input Task input
   * @param correlationId Correlation ID for tracing
   * @returns Task result
   * @throws NormalizedProviderError on failure
   */
  async execute(input: ACPExecuteInput, correlationId: string): Promise<ACPExecuteOutput> {
    if (!this.config) {
      throw new NormalizedProviderError(
        "PROVIDER_UNAVAILABLE",
        "ACP client not initialized",
        "acp"
      );
    }

    try {
      // Check policy gate
      const policyDecision = await this.policyGate.evaluate("provider.acp.execute", {
        correlationId,
        prompt: input.prompt,
      });

      if (!policyDecision.allowed) {
        const reason = policyDecision.reason || "Policy denied";

        await this.publishEvent("provider.acp.policy.denied", {
          correlationId,
          reason,
        });

        throw new NormalizedProviderError(
          "PROVIDER_POLICY_DENIED",
          `ACP execution denied by policy: ${reason}`,
          "acp",
          false,
          correlationId
        );
      }

      // Create abort controller for timeout
      const abortController = new AbortController();
      const timeoutMs = this.config.timeout || 30000;
      const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);
      this.inFlightTasks.set(correlationId, abortController);

      try {
        const _startTime = Date.now();

        // Construct ACP request
        const acpRequest: ACPRequest = {
          correlationId,
          model: this.config.model,
          messages: [
            {
              role: "user",
              content: input.prompt,
            },
          ],
          maxTokens: input.maxTokens,
          temperature: input.temperature,
        };

        // Execute task (mock implementation)
        const result = await this.sendACPRequest(acpRequest, abortController.signal);

        const _duration = Date.now() - startTime;

        // Publish success event
        await this.publishEvent("provider.acp.execute.completed", {
          correlationId,
          taskId: result.taskId,
          duration,
          usage: result.usage,
        });

        return {
          content: result.content,
          stopReason: result.stopReason,
          usage: result.usage,
        };
      } finally {
        clearTimeout(timeoutHandle);
        this.inFlightTasks.delete(correlationId);
      }
    } catch {
      // Handle timeout
      if (error instanceof Error && error.name === "AbortError") {
        const normalized = new NormalizedProviderError(
          "PROVIDER_TIMEOUT",
          `ACP execution timeout after ${this.config.timeout || 30000}ms`,
          "acp",
          true,
          correlationId
        );

        await this.publishEvent("provider.acp.execute.failed", {
          correlationId,
          code: normalized.code,
          retryable: normalized.retryable,
          message: normalized.message,
        });

        throw normalized;
      }

      // Handle other errors
      const normalized = normalizeError(error, "acp", correlationId);

      await this.publishEvent("provider.acp.execute.failed", {
        correlationId,
        code: normalized.code,
        retryable: normalized.retryable,
        message: normalized.message,
      });

      throw normalized;
    }
  }

  /**
   * Cancel a task.
   *
   * @param taskId Task ID to cancel
   * @throws NormalizedProviderError on failure
   */
  async cancel(taskId: string): Promise<void> {
    if (!this.config) {
      throw new NormalizedProviderError(
        "PROVIDER_UNAVAILABLE",
        "ACP client not initialized",
        "acp"
      );
    }

    try {
      // Abort in-flight task if found
      for (const [correlationId, controller] of this.inFlightTasks) {
        // In a real implementation, we would match the task ID
        // For now, we just track by correlation ID
        if (correlationId === taskId) {
          controller.abort();
        }
      }

      await this.publishEvent("provider.acp.execute.cancelled", {
        taskId,
      });
    } catch {
      const normalized = normalizeError(error, "acp");

      throw new NormalizedProviderError(
        "PROVIDER_EXECUTE_FAILED",
        `Failed to cancel task ${taskId}: ${normalized.message}`,
        "acp"
      );
    }
  }

  /**
   * Terminate ACP client and cleanup resources.
   *
   * NFR-025-004: No resource leaks on termination.
   */
  async terminate(): Promise<void> {
    try {
      // Cancel all in-flight tasks
      for (const controller of this.inFlightTasks.values()) {
        controller.abort();
      }
      this.inFlightTasks.clear();

      // Clear config
      this.config = null;

      this.healthStatus = {
        state: "unavailable",
        lastCheck: new Date(),
        failureCount: 0,
        message: "Terminated",
      };

      await this.publishEvent("provider.acp.terminated", {});
    } catch {
      const normalized = normalizeError(error, "acp");

      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        `Failed to terminate ACP client: ${normalized.message}`,
        "acp",
        false
      );
    }
  }

  /**
   * Probe endpoint for reachability.
   *
   * @param endpoint Endpoint URL
   * @returns true if reachable, false otherwise
   */
  private async probeEndpoint(endpoint: string): Promise<boolean> {
    // Mock implementation: always return true for test endpoints
    if (endpoint.includes("localhost") || endpoint.includes("127.0.0.1")) {
      return true;
    }

    // In a real implementation, this would make a lightweight HTTP request
    return true;
  }

  /**
   * Send request to ACP endpoint.
   *
   * @param request ACP request
   * @param signal Abort signal
   * @returns ACP response
   */
  private async sendACPRequest(request: ACPRequest, signal: AbortSignal): Promise<ACPResponse> {
    // Check for abort
    if (signal.aborted) {
      throw new Error("Request aborted");
    }

    // Mock implementation: simulate ACP processing
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        resolve({
          taskId: `task-${request.correlationId}`,
          content: "This is a mock ACP response.",
          stopReason: "end_turn",
          usage: {
            inputTokens: 10,
            outputTokens: 20,
          },
        });
      }, 10);

      // Clean up on abort
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        throw new Error("Request cancelled");
      });
    });
  }

  /**
   * Publish event on the protocol bus.
   *
   * @param topic Event topic
   * @param payload Event payload
   */
  private async publishEvent(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.bus) {
      return; // Bus not configured, skip event publishing
    }

    try {
      await this.bus.publish({
        id: `acp-${Date.now()}-${Math.random()}`,
        type: "event",
        ts: new Date().toISOString(),
        topic,
        payload,
      });
    } catch {
      // Log but don't throw (event publishing is best-effort)
      console.warn(`Failed to publish ACP event ${topic}:`, error);
    }
  }
}
