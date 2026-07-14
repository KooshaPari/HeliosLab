/**
 * Provider Registry and Lifecycle Management
 *
 * Manages provider registrations with validation, credential binding,
 * and lifecycle tracking. Enforces concurrency limits and emits
 * lifecycle events on the protocol bus.
 *
 * FR-025-002: Provider registration with validation and credential binding.
 * FR-025-008: Binding providers to lanes for failure isolation.
 */

import type { LocalBus } from "../protocol/bus.js";
import type { ProviderAdapter, ProviderRegistration, ProviderHealthStatus } from "./adapter.js";


/**
 * Registered provider instance with metadata.
 */
interface RegisteredProvider {
  id: string;
  type: "acp" | "mcp" | "a2a";
  adapter: ProviderAdapter<any, any, any>;
  registration: ProviderRegistration<any>;
  healthStatus: ProviderHealthStatus;
  inFlightCount: number;
  laneIds: Set<string>; // Lanes this provider is bound to
}

/**
 * Provider Registry
 *
 * Manages provider registrations, validation, credential binding,
 * and lifecycle. Enforces concurrency limits and publishes events
 * on the protocol bus.
 *
 * FR-025-002: Configuration validation, credential binding, lifecycle tracking.
 */
export class ProviderRegistry {
  /** Map of provider ID to registered provider instance */
  private providers = new Map<string, RegisteredProvider>();

  /** Reference to the protocol bus for event publishing */
  private bus: LocalBus | null = null;

  constructor(bus?: LocalBus) {
    this.bus = bus || null;
  }

  /**
   * Register a provider with the registry.
   *
   * Steps:
   * 1. Validate registration configuration (required fields, limits, intervals)
   * 2. Validate provider configuration schema
   * 3. Create adapter instance from provider type
   * 4. Call adapter.init() with validated config
   * 5. Add to registry and emit lifecycle event
   *
   * FR-025-002: Configuration validation and credential binding.
   *
   * @param registration Provider registration with config and metadata
   * @param adapter Pre-created adapter instance to manage
   * @throws NormalizedProviderError if validation fails or init fails
   */
  async register<TConfig, TInput, TOutput>(
    registration: ProviderRegistration<TConfig>,
    adapter: ProviderAdapter<TConfig, TInput, TOutput>
  ): Promise<void> {
    // Validate registration configuration
    this.validateRegistration(registration);

    try {
      // Initialize adapter with validated config
      await adapter.init(registration.config);

      // Get initial health status
      const healthStatus = await adapter.health();

      // Create registered provider instance
      const registeredProvider: RegisteredProvider = {
        id: registration.id,
        type: registration.type,
        adapter,
        registration,
        healthStatus,
        inFlightCount: 0,
        laneIds: new Set(),
      };

      // Add to registry
      this.providers.set(registration.id, registeredProvider);

      // Emit lifecycle event
      await this.publishEvent("provider.registered", {
        providerId: registration.id,
        type: registration.type,
        workspaceId: registration.workspaceId,
      });
    } catch {
      // Normalize error and emit failure event
      const normalized = normalizeError(error, "internal");

      await this.publishEvent("provider.init.failed", {
        providerId: registration.id,
        type: registration.type,
        workspaceId: registration.workspaceId,
        error: {
          code: normalized.code,
          message: normalized.message,
        },
      });

      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        `Failed to register provider ${registration.id}: ${normalized.message}`,
        "internal",
        false,
        undefined,
        normalized instanceof Error ? normalized : undefined
      );
    }
  }

  /**
   * Unregister a provider and cleanup resources.
   *
   * FR-025-008: Lane binding cleanup.
   *
   * @param providerId ID of provider to unregister
   * @throws NormalizedProviderError if provider not found or terminate fails
   */
  async unregister(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new NormalizedProviderError(
        "PROVIDER_UNKNOWN",
        `Provider ${providerId} not found in registry`,
        "internal"
      );
    }

    try {
      // Terminate adapter and cleanup resources
      await provider.adapter.terminate();

      // Remove from registry
      this.providers.delete(providerId);

      // Emit lifecycle event
      await this.publishEvent("provider.unregistered", {
        providerId: providerId,
        type: provider.type,
        workspaceId: provider.registration.workspaceId,
      });
    } catch {
      const normalized = normalizeError(error, "internal");

      // Log error but still remove from registry (force cleanup)
      this.providers.delete(providerId);

      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        `Failed to unregister provider ${providerId}: ${normalized.message}`,
        "internal",
        false
      );
    }
  }

  /**
   * Get a registered provider by ID.
   *
   * @param providerId ID of provider to retrieve
   * @returns Registered provider or undefined if not found
   */
  get(providerId: string): ProviderAdapter<any, any, any> | undefined {
    const provider = this.providers.get(providerId);
    return provider?.adapter;
  }

  /**
   * List all registered providers by type.
   *
   * @param type Provider type to filter by
   * @returns Array of adapters matching the type
   */
  listByType(type: "acp" | "mcp" | "a2a"): ProviderAdapter<any, any, any>[] {
    const result: ProviderAdapter<any, any, any>[] = [];

    for (const provider of this.providers.values()) {
      if (provider.type === type) {
        result.push(provider.adapter);
      }
    }

    return result;
  }

  /**
   * List all registered providers bound to a workspace.
   *
   * @param workspaceId Workspace ID to filter by
   * @returns Array of adapters bound to the workspace
   */
  listByWorkspace(workspaceId: string): ProviderAdapter<any, any, any>[] {
    const result: ProviderAdapter<any, any, any>[] = [];

    for (const provider of this.providers.values()) {
      if (provider.registration.workspaceId === workspaceId) {
        result.push(provider.adapter);
      }
    }

    return result;
  }

  /**
   * Bind a provider to a lane for failure isolation.
   *
   * FR-025-008: Lane binding for process-level isolation.
   *
   * @param providerId Provider ID
   * @param laneId Lane ID
   */
  bindToLane(providerId: string, laneId: string): void {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new NormalizedProviderError(
        "PROVIDER_UNKNOWN",
        `Provider ${providerId} not found in registry`,
        "internal"
      );
    }

    provider.laneIds.add(laneId);
  }

  /**
   * Unbind a provider from a lane.
   *
   * @param providerId Provider ID
   * @param laneId Lane ID
   */
  unbindFromLane(providerId: string, laneId: string): void {
    const provider = this.providers.get(providerId);

    if (provider) {
      provider.laneIds.delete(laneId);
    }
  }

  /**
   * Get all providers bound to a lane.
   *
   * @param laneId Lane ID
   * @returns Array of provider IDs bound to the lane
   */
  getProvidersForLane(laneId: string): string[] {
    const result: string[] = [];

    for (const provider of this.providers.values()) {
      if (provider.laneIds.has(laneId)) {
        result.push(provider.id);
      }
    }

    return result;
  }

  /**
   * Check and enforce concurrency limit for a provider.
   *
   * FR-025-002: Concurrency limit enforcement.
   *
   * @param providerId Provider ID
   * @throws NormalizedProviderError if limit exceeded
   */
  checkConcurrencyLimit(providerId: string): void {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new NormalizedProviderError(
        "PROVIDER_UNKNOWN",
        `Provider ${providerId} not found`,
        "internal"
      );
    }

    if (provider.inFlightCount >= provider.registration.concurrencyLimit) {
      throw new NormalizedProviderError(
        "PROVIDER_CONCURRENCY_EXCEEDED",
        `Provider ${providerId} concurrency limit (${provider.registration.concurrencyLimit}) exceeded`,
        "internal"
      );
    }
  }

  /**
   * Increment in-flight count for a provider.
   *
   * @param providerId Provider ID
   */
  incrementInFlight(providerId: string): void {
    const provider = this.providers.get(providerId);

    if (provider) {
      provider.inFlightCount++;
    }
  }

  /**
   * Decrement in-flight count for a provider.
   *
   * @param providerId Provider ID
   */
  decrementInFlight(providerId: string): void {
    const provider = this.providers.get(providerId);

    if (provider && provider.inFlightCount > 0) {
      provider.inFlightCount--;
    }
  }

  /**
   * Update health status for a provider.
   *
   * @param providerId Provider ID
   * @param status New health status
   */
  updateHealthStatus(providerId: string, status: ProviderHealthStatus): void {
    const provider = this.providers.get(providerId);

    if (provider) {
      provider.healthStatus = status;
    }
  }

  /**
   * Get health status for a provider.
   *
   * @param providerId Provider ID
   * @returns Health status or undefined if not found
   */
  getHealthStatus(providerId: string): ProviderHealthStatus | undefined {
    const provider = this.providers.get(providerId);
    return provider?.healthStatus;
  }

  /**
   * Validate provider registration configuration.
   *
   * FR-025-002: Configuration validation.
   *
   * @param registration Registration to validate
   * @throws NormalizedProviderError if validation fails
   */
  private validateRegistration<TConfig>(registration: ProviderRegistration<TConfig>): void {
    // Check required fields
    if (!registration.id || typeof registration.id !== "string") {
      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        "Registration missing required field: id",
        "internal"
      );
    }

    if (!registration.type || !["acp", "mcp", "a2a"].includes(registration.type)) {
      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        "Registration missing or invalid required field: type",
        "internal"
      );
    }

    if (!registration.workspaceId || typeof registration.workspaceId !== "string") {
      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        "Registration missing required field: workspaceId",
        "internal"
      );
    }

    // Validate concurrency limit (1-100)
    if (
      typeof registration.concurrencyLimit !== "number" ||
      registration.concurrencyLimit < 1 ||
      registration.concurrencyLimit > 100
    ) {
      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        `Invalid concurrency limit: ${registration.concurrencyLimit} (must be 1-100)`,
        "internal"
      );
    }

    // Validate health check interval (minimum 5000ms)
    if (
      typeof registration.healthCheckIntervalMs !== "number" ||
      registration.healthCheckIntervalMs < 5000
    ) {
      throw new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        `Invalid health check interval: ${registration.healthCheckIntervalMs} (minimum 5000ms)`,
        "internal"
      );
    }
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
        id: `provider-${Date.now()}-${Math.random()}`,
        type: "event",
        ts: new Date().toISOString(),
        topic,
        payload,
      });
    } catch {
      // Log error but don't throw (event publishing is best-effort)
      console.warn(`Failed to publish provider event ${topic}:`, error);
    }
  }
}
