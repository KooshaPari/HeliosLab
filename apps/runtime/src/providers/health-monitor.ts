/**
 * Health Monitoring Coordinator — extracted from a2a-router.ts for static analysis compliance.
 *
 * Manages health state for all registered providers across all types (ACP, MCP, A2A).
 * Publishes state transitions on the bus and coordinates failover decisions.
 *
 * FR-025-009: Health monitoring for all providers.
 * FR-025-010: Failover routing based on health state.
 */

import type { LocalBus } from "../protocol/bus.js";
import type { ProviderHealthStatus } from "./adapter.js";

export class HealthMonitoringCoordinator {
  private providerHealthMap = new Map<string, ProviderHealthStatus>();
  private healthCheckIntervals = new Map<string, NodeJS.Timeout>();
  private bus: LocalBus | null = null;

  constructor(bus?: LocalBus) {
    this.bus = bus || null;
  }

  /**
   * Register a provider for health monitoring.
   *
   * @param providerId Provider ID
   * @param interval Health check interval in milliseconds
   * @param checkFunction Async function that returns health status
   */
  registerProvider(
    providerId: string,
    interval: number,
    checkFunction: () => Promise<ProviderHealthStatus>
  ): void {
    // Store initial health
    this.providerHealthMap.set(providerId, {
      state: "unavailable",
      lastCheck: new Date(),
      failureCount: 0,
    });

    // Schedule periodic health checks
    const intervalId = setInterval(async () => {
      try {
        const status = await checkFunction();
        const previousStatus = this.providerHealthMap.get(providerId);

        // Update health
        this.providerHealthMap.set(providerId, status);

        // Publish transition if state changed
        if (previousStatus?.state !== status.state) {
          await this.publishEvent("provider.health.transitioned", {
            providerId,
            previousState: previousStatus?.state,
            newState: status.state,
            failureCount: status.failureCount,
          });
        }
      } catch {
        // Health polling errors are intentionally isolated per interval tick.
      }
    }, interval);

    this.healthCheckIntervals.set(providerId, intervalId);
  }

  /**
   * Unregister a provider from health monitoring.
   *
   * @param providerId Provider ID
   */
  unregisterProvider(providerId: string): void {
    const intervalId = this.healthCheckIntervals.get(providerId);
    if (intervalId) {
      clearInterval(intervalId);
      this.healthCheckIntervals.delete(providerId);
    }
    this.providerHealthMap.delete(providerId);
  }

  /**
   * Get health status for a provider.
   *
   * @param providerId Provider ID
   * @returns Health status or undefined if not found
   */
  getProviderHealth(providerId: string): ProviderHealthStatus | undefined {
    return this.providerHealthMap.get(providerId);
  }

  /**
   * Get all healthy providers of a given type.
   *
   * @param type Provider type
   * @returns Array of provider IDs
   */
  getHealthyProvidersByType(type: string): string[] {
    const providers: string[] = [];
    for (const [providerId, status] of this.providerHealthMap) {
      // Filter by type (mock: assume ID prefix indicates type)
      if (providerId.startsWith(type) && status.state === "healthy") {
        providers.push(providerId);
      }
    }
    return providers;
  }

  /**
   * Cleanup and stop monitoring.
   */
  shutdown(): void {
    for (const intervalId of this.healthCheckIntervals.values()) {
      clearInterval(intervalId);
    }
    this.healthCheckIntervals.clear();
    this.providerHealthMap.clear();
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
        id: `health-${Date.now()}-${Math.random()}`,
        type: "event",
        ts: new Date().toISOString(),
        topic,
        payload,
      });
    } catch {
      // Best-effort event publishing should not fail coordinator flow.
    }
  }
}
