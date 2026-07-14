/**
 * A2A Federation Router and Failover
 *
 * Implements the A2A protocol client adapter for external agent delegation
 * with endpoint registration, failover routing, and failure isolation.
 *
 * FR-025-005: A2A federation with failure isolation.
 * FR-025-010: Failover routing for degraded providers.
 */

import type { LocalBus } from "../protocol/bus.js";
import type {
  ProviderAdapter,
  ProviderHealthStatus,
  A2AConfig,
} from "./adapter.js";
import { NormalizedProviderError, normalizeError } from "./errors.js";

export { HealthMonitoringCoordinator } from "./health-monitor.js";

/**
 * A2A endpoint configuration.
 */
// biome-ignore lint/style/useNamingConvention: A2A acronym is part of the external provider protocol name.
export interface A2AEndpoint {
  id: string;
  url: string;
  priority: number;
  capabilities: string[];
  healthStatus?: ProviderHealthStatus;
}

/**
 * A2A delegation context.
 */
// biome-ignore lint/style/useNamingConvention: A2A acronym is part of the external provider protocol name.
export interface A2ADelegation {
  taskDescription: string;
  requiredCapabilities: string[];
  context: Record<string, unknown>;
}

/**
 * A2A delegation result.
 */
// biome-ignore lint/style/useNamingConvention: A2A acronym is part of the external provider protocol name.
export interface A2AResult {
  endpointId: string;
  result: unknown;
  correlationId: string;
  duration: number;
}

/**
 * A2A Router Configuration.
 */
// biome-ignore lint/style/useNamingConvention: A2A acronym is part of the external provider protocol name.
export interface A2ARouterConfig extends A2AConfig {
  endpoints?: Array<{
    id: string;
    url: string;
    priority: number;
    capabilities: string[];
  }>;
}

/**
 * A2A Router Adapter
 *
 * Routes delegations to external agents via A2A protocol with:
 * - Endpoint registration and capability matching
 * - Health-aware routing
 * - Failure isolation per lane
 * - Failover support (slice-1: single endpoint, slice-2: multi-endpoint)
 *
 * FR-025-005: A2A federation with external agent delegation.
 */
// biome-ignore lint/style/useNamingConvention: A2A acronym is part of the external provider protocol name.
export class A2ARouterAdapter implements ProviderAdapter<
  A2ARouterConfig,
  A2ADelegation & { correlationId?: string },
  A2AResult
> {
  private config: A2ARouterConfig | null = null;
  private bus: LocalBus | null = null;
  private endpoints: A2AEndpoint[] = [];
  private healthStatus: ProviderHealthStatus = {
    state: "unavailable",
    lastCheck: new Date(),
    failureCount: 0,
  };
  private inFlightDelegations = new Map<string, AbortController>();

  constructor(bus?: LocalBus) {
    this.bus = bus || null;
  }

  /**
   * Initialize A2A router with endpoint configuration.
   *
   * FR-025-005: A2A router initialization.
   *
   * @param config A2A router configuration
   * @throws NormalizedProviderError if init fails
   */
  async init(config: A2ARouterConfig): Promise<void> {
    try {
      // Validate config
      if (!config.endpoints || !Array.isArray(config.endpoints) || config.endpoints.length === 0) {
        throw new Error("Missing or invalid endpoints");
      }

      this.config = config;

      // Initialize endpoints sorted by priority
      this.endpoints = config.endpoints
        .map(ep => ({
          id: ep.id,
          url: ep.url,
          priority: ep.priority,
          capabilities: ep.capabilities,
          healthStatus: {
            state: "healthy" as const,
            lastCheck: new Date(),
            failureCount: 0,
          },
        }))
        .sort((a, b) => a.priority - b.priority);

      // Perform initial health probes
      for (const endpoint of this.endpoints) {
        try {
          await this.probeEndpoint(endpoint);
        } catch {
          endpoint.healthStatus = {
            state: "unavailable",
            lastCheck: new Date(),
            failureCount: 1,
            message: `Probe failed: ${normalizeError(error, "a2a").message}`,
          };
        }
      }

      this.healthStatus = {
        state: "healthy",
        lastCheck: new Date(),
        failureCount: 0,
      };

      await this.publishEvent("provider.a2a.initialized", {
        endpointCount: this.endpoints.length,
      });
    } catch {
      const normalized = normalizeError(error, "a2a");

      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        `A2A router init failed: ${normalized.message}`,
        "a2a",
        false
      );
    }
  }

  /**
   * Get current health status.
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
      // Check if any endpoint is healthy
      const healthyEndpoints = this.endpoints.filter(ep => ep.healthStatus?.state === "healthy");

      if (healthyEndpoints.length > 0) {
        this.healthStatus = {
          state: "healthy",
          lastCheck: new Date(),
          failureCount: 0,
        };
      } else {
        this.healthStatus.failureCount++;
        const newState = this.healthStatus.failureCount >= 5 ? "unavailable" : "degraded";
        this.healthStatus = {
          state: newState,
          lastCheck: new Date(),
          failureCount: this.healthStatus.failureCount,
          message: "No healthy endpoints available",
        };
      }
    } catch {
      this.healthStatus.failureCount++;
      this.healthStatus = {
        state: "unavailable",
        lastCheck: new Date(),
        failureCount: this.healthStatus.failureCount,
        message: `Health check failed: ${normalizeError(error, "a2a").message}`,
      };
    }

    return { ...this.healthStatus };
  }

  /**
   * Execute a delegation request.
   *
   * FR-025-005: A2A task delegation with failure isolation.
   * FR-025-010: Failover to healthy endpoint.
   *
   * @param input Delegation request
   * @param correlationId Correlation ID for tracing
   * @returns Delegation result
   * @throws NormalizedProviderError on failure
   */
  async execute(
    input: A2ADelegation & { correlationId?: string },
    correlationId: string
  ): Promise<A2AResult> {
    if (!this.config || this.endpoints.length === 0) {
      throw new NormalizedProviderError(
        "PROVIDER_UNAVAILABLE",
        "A2A router not initialized or no endpoints configured",
        "a2a"
      );
    }

    try {
      // Select endpoint by matching capabilities (FR-025-010: failover)
      const selectedEndpoint = this.selectEndpoint(input.requiredCapabilities);

      if (!selectedEndpoint) {
        throw new Error(
          `No endpoint found with required capabilities: ${input.requiredCapabilities.join(", ")}`
        );
      }

      // Create abort controller for timeout
      const abortController = new AbortController();
      const timeoutMs = this.config.timeout || 30000;
      const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);
      this.inFlightDelegations.set(correlationId, abortController);

      try {
        const _startTime = Date.now();

        // Send delegation request
        const result = await this.sendDelegation(
          selectedEndpoint,
          input,
          correlationId,
          abortController.signal
        );

        const _duration = Date.now() - startTime;

        // Publish success event
        await this.publishEvent("provider.a2a.delegation.completed", {
          correlationId,
          endpointId: selectedEndpoint.id,
          duration,
        });

        return {
          endpointId: selectedEndpoint.id,
          result,
          correlationId,
          duration,
        };
      } finally {
        clearTimeout(timeoutHandle);
        this.inFlightDelegations.delete(correlationId);
      }
    } catch {
      // Handle timeout
      if (error instanceof Error && error.name === "AbortError") {
        const normalized = new NormalizedProviderError(
          "PROVIDER_TIMEOUT",
          `A2A delegation timeout after ${this.config?.timeout || 30000}ms`,
          "a2a",
          true,
          correlationId
        );

        await this.publishEvent("provider.a2a.delegation.failed", {
          correlationId,
          code: normalized.code,
          message: normalized.message,
        });

        throw normalized;
      }

      // Handle other errors
      const normalized = normalizeError(error, "a2a", correlationId);

      await this.publishEvent("provider.a2a.delegation.failed", {
        correlationId,
        code: normalized.code,
        message: normalized.message,
      });

      throw normalized;
    }
  }

  /**
   * Terminate A2A router and cleanup resources.
   */
  async terminate(): Promise<void> {
    try {
      // Cancel all in-flight delegations
      for (const controller of this.inFlightDelegations.values()) {
        controller.abort();
      }
      this.inFlightDelegations.clear();

      // Clear endpoints
      this.endpoints = [];
      this.config = null;

      this.healthStatus = {
        state: "unavailable",
        lastCheck: new Date(),
        failureCount: 0,
        message: "Terminated",
      };

      await this.publishEvent("provider.a2a.terminated", {});
    } catch {
      const normalized = normalizeError(error, "a2a");

      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        `Failed to terminate A2A router: ${normalized.message}`,
        "a2a",
        false
      );
    }
  }

  /**
   * Get all endpoints.
   *
   * @returns Array of endpoints
   */
  getEndpoints(): A2AEndpoint[] {
    return [...this.endpoints];
  }

  /**
   * Update endpoint health status.
   *
   * @param endpointId Endpoint ID
   * @param status New health status
   */
  updateEndpointHealth(endpointId: string, status: ProviderHealthStatus): void {
    const endpoint = this.endpoints.find(ep => ep.id === endpointId);
    if (endpoint) {
      endpoint.healthStatus = status;
    }
  }

  /**
   * Select endpoint by matching capabilities and health.
   *
   * Uses first healthy endpoint that matches required capabilities,
   * falling back to degraded endpoints if no healthy ones available.
   *
   * FR-025-010: Failover to healthy endpoint.
   *
   * @param requiredCapabilities Required capabilities
   * @returns Selected endpoint or undefined if no match
   */
  private selectEndpoint(requiredCapabilities: string[]): A2AEndpoint | undefined {
    // First pass: look for healthy endpoint with matching capabilities
    let selected = this.endpoints.find(
      ep => ep.healthStatus?.state === "healthy" && this.hasCapabilities(ep, requiredCapabilities)
    );

    // Second pass: look for degraded endpoint (for failover)
    if (!selected) {
      selected = this.endpoints.find(
        ep =>
          ep.healthStatus?.state === "degraded" && this.hasCapabilities(ep, requiredCapabilities)
      );
    }

    // Final fallback: any endpoint with matching capabilities
    if (!selected) {
      selected = this.endpoints.find(ep => this.hasCapabilities(ep, requiredCapabilities));
    }

    return selected;
  }

  /**
   * Check if endpoint has required capabilities.
   *
   * @param endpoint Endpoint to check
   * @param requiredCapabilities Required capabilities
   * @returns true if endpoint has all required capabilities
   */
  private hasCapabilities(endpoint: A2AEndpoint, requiredCapabilities: string[]): boolean {
    if (requiredCapabilities.length === 0) {
      return true;
    }

    const endpointCaps = new Set(endpoint.capabilities);
    return requiredCapabilities.every(cap => endpointCaps.has(cap));
  }

  /**
   * Probe endpoint for reachability.
   *
   * @param endpoint Endpoint to probe
   * @throws Error if probe fails
   */
  private async probeEndpoint(endpoint: A2AEndpoint): Promise<void> {
    await Promise.resolve();
    // Mock implementation: always succeeds for localhost/127.0.0.1
    if (endpoint.url.includes("localhost") || endpoint.url.includes("127.0.0.1")) {
      return;
    }

    // In a real implementation, this would make an HTTP request
    return;
  }

  /**
   * Send delegation to endpoint.
   *
   * @param endpoint Target endpoint
   * @param delegation Delegation request
   * @param correlationId Correlation ID
   * @param signal Abort signal
   * @returns Delegation result
   */
  private async sendDelegation(
    endpoint: A2AEndpoint,
    delegation: A2ADelegation & { correlationId?: string },
    correlationId: string,
    signal: AbortSignal
  ): Promise<unknown> {
    await Promise.resolve();
    // Check for abort
    if (signal.aborted) {
      throw new Error("Delegation cancelled");
    }

    // Mock implementation: return simulated result
    return {
      delegatedAt: new Date().toISOString(),
      taskDescription: delegation.taskDescription,
      result: "Mock A2A delegation result",
    };
  }

  /**
   * Publish event on the protocol bus.
   *
   * @param topic Event topic
   * @param payload Event payload
   */
  private async publishEvent(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.bus) {
      return;
    }

    try {
      await this.bus.publish({
        id: `a2a-${Date.now()}-${Math.random()}`,
        type: "event",
        ts: new Date().toISOString(),
        topic,
        payload,
      });
    } catch {
      // Best-effort event publishing should not fail delegation flow.
    }
  }
}
