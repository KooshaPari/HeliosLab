/**
 * Tests for ProviderRegistry — Lane Binding and Health Status
 *
 * FR-025-008: Lane binding and failure isolation.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ProviderRegistry } from "../registry.js";

import type { ACPConfig, ACPExecuteInput, ACPExecuteOutput } from "../adapter.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";

/**
 * Mock provider for testing registry behavior.
 */
class TestProvider implements ProviderAdapter<ACPConfig, ACPExecuteInput, ACPExecuteOutput> {
  private initialized = false;

  async init(config: ACPConfig): Promise<void> {
    if (!config.apiKey) {
      throw new Error("Missing API key");
    }
    this.initialized = true;
  }

  async health(): Promise<ProviderHealthStatus> {
    return {
      state: this.initialized ? "healthy" : "unavailable",
      lastCheck: new Date(),
      failureCount: 0,
    };
  }

  async execute(_input: ACPExecuteInput, _correlationId: string): Promise<ACPExecuteOutput> {
    if (!this.initialized) {
      throw new Error("Not initialized");
    }
    return {
      content: "Test response",
      stopReason: "end_turn",
    };
  }

  async terminate(): Promise<void> {
    this.initialized = false;
  }
}

describe("ProviderRegistry — Lane Binding", () => {
  let registry: ProviderRegistry;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
    registry = new ProviderRegistry(bus);
  });

  describe("Lane Binding", () => {
    it("should bind provider to lane", async () => {
      const adapter = new TestProvider();
      await registry.register(
        {
          id: "test-provider",
          type: "acp",
          config: { apiKey: "test", model: "claude-3-sonnet" },
          workspaceId: "ws-1",
          concurrencyLimit: 10,
          healthCheckIntervalMs: 30000,
        },
        adapter
      );

      registry.bindToLane("test-provider", "lane-1");

      const providers = registry.getProvidersForLane("lane-1");
      expect(providers).toContain("test-provider");
    });

    it("should unbind provider from lane", async () => {
      const adapter = new TestProvider();
      await registry.register(
        {
          id: "test-provider",
          type: "acp",
          config: { apiKey: "test", model: "claude-3-sonnet" },
          workspaceId: "ws-1",
          concurrencyLimit: 10,
          healthCheckIntervalMs: 30000,
        },
        adapter
      );

      registry.bindToLane("test-provider", "lane-1");
      expect(registry.getProvidersForLane("lane-1")).toContain("test-provider");

      registry.unbindFromLane("test-provider", "lane-1");
      expect(registry.getProvidersForLane("lane-1")).not.toContain("test-provider");
    });

    it("should get all providers for a lane", async () => {
      const adapter1 = new TestProvider();
      const adapter2 = new TestProvider();

      await registry.register(
        {
          id: "provider-1",
          type: "acp",
          config: { apiKey: "test", model: "claude-3-sonnet" },
          workspaceId: "ws-1",
          concurrencyLimit: 10,
          healthCheckIntervalMs: 30000,
        },
        adapter1
      );

      await registry.register(
        {
          id: "provider-2",
          type: "mcp",
          config: { apiKey: "test", model: "claude-3-sonnet" },
          workspaceId: "ws-1",
          concurrencyLimit: 10,
          healthCheckIntervalMs: 30000,
        },
        adapter2
      );

      registry.bindToLane("provider-1", "lane-1");
      registry.bindToLane("provider-2", "lane-1");

      const providers = registry.getProvidersForLane("lane-1");
      expect(providers).toHaveLength(2);
      expect(providers).toContain("provider-1");
      expect(providers).toContain("provider-2");
    });
  });

  describe("Health Status Tracking", () => {
    it("should update health status", async () => {
      const adapter = new TestProvider();
      await registry.register(
        {
          id: "test-provider",
          type: "acp",
          config: { apiKey: "test", model: "claude-3-sonnet" },
          workspaceId: "ws-1",
          concurrencyLimit: 10,
          healthCheckIntervalMs: 30000,
        },
        adapter
      );

      const status = {
        state: "degraded" as const,
        lastCheck: new Date(),
        failureCount: 2,
        message: "Slow response",
      };

      registry.updateHealthStatus("test-provider", status);

      const retrieved = registry.getHealthStatus("test-provider");
      expect(retrieved?.state).toBe("degraded");
      expect(retrieved?.failureCount).toBe(2);
    });
  });
});
