/**
 * Tests for ProviderRegistry
 *
 * FR-025-002: Configuration validation, credential binding, concurrency limits.
 * FR-025-008: Lane binding and failure isolation.
 * Traces to: FR-MVP-014 (Anthropic API), FR-MVP-018 (switch providers), FR-MVP-019 (graceful fallback)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ProviderRegistry } from "../registry.js";

import type { ProviderAdapter, ProviderHealthStatus, ProviderRegistration } from "../adapter.js";
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

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
    registry = new ProviderRegistry(bus);
  });

  describe("Registration", () => {
    it("should register a provider with valid config", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: {
          apiKey: "test-key",
          model: "claude-3-sonnet",
        },
        workspaceId: "ws-1",
        concurrencyLimit: 10,
        healthCheckIntervalMs: 30000,
      };

      await registry.register(registration, adapter);

      const retrieved = registry.get("test-provider");
      expect(retrieved).toBeDefined();
    });

    it("should reject registration with missing ID", async () => {
      const adapter = new TestProvider();
      const registration: any = {
        id: null,
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 10,
        healthCheckIntervalMs: 30000,
      };

      await expect(registry.register(registration, adapter)).rejects.toThrow(
        /missing required field: id/i
      );
    });

    it("should reject registration with invalid concurrency limit", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 101, // Exceeds max of 100
        healthCheckIntervalMs: 30000,
      };

      await expect(registry.register(registration, adapter)).rejects.toThrow(
        /invalid concurrency limit/i
      );
    });

    it("should reject registration with concurrency limit < 1", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 0,
        healthCheckIntervalMs: 30000,
      };

      await expect(registry.register(registration, adapter)).rejects.toThrow(
        /invalid concurrency limit/i
      );
    });

    it("should reject registration with invalid health check interval", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 10,
        healthCheckIntervalMs: 1000, // Below minimum of 5000
      };

      await expect(registry.register(registration, adapter)).rejects.toThrow(
        /invalid health check interval/i
      );
    });

    it("should emit provider.registered event on successful registration", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 10,
        healthCheckIntervalMs: 30000,
      };

      await registry.register(registration, adapter);

      const events = bus.getEvents();
      const registeredEvent = events.find(e => e.topic === "provider.registered");
      expect(registeredEvent).toBeDefined();
      expect(registeredEvent?.payload?.providerId).toBe("test-provider");
    });

    it("should emit provider.init.failed event on init failure", async () => {
      class FailingProvider implements ProviderAdapter<
        ACPConfig,
        ACPExecuteInput,
        ACPExecuteOutput
      > {
        async init(_config: ACPConfig): Promise<void> {
          throw new Error("Init failed");
        }
        async health(): Promise<ProviderHealthStatus> {
          return {
            state: "unavailable",
            lastCheck: new Date(),
            failureCount: 0,
          };
        }
        async execute(_input: ACPExecuteInput, _correlationId: string): Promise<ACPExecuteOutput> {
          return { content: "", stopReason: "" };
        }
        async terminate(): Promise<void> {}
      }

      const adapter = new FailingProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "failing-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 10,
        healthCheckIntervalMs: 30000,
      };

      await expect(registry.register(registration, adapter)).rejects.toThrow();

      const events = bus.getEvents();
      const failedEvent = events.find(e => e.topic === "provider.init.failed");
      expect(failedEvent).toBeDefined();
    });
  });

  describe("Unregistration", () => {
    it("should unregister a provider", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 10,
        healthCheckIntervalMs: 30000,
      };

      await registry.register(registration, adapter);
      expect(registry.get("test-provider")).toBeDefined();

      await registry.unregister("test-provider");
      expect(registry.get("test-provider")).toBeUndefined();
    });

    it("should emit provider.unregistered event", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 10,
        healthCheckIntervalMs: 30000,
      };

      await registry.register(registration, adapter);
      bus.getEvents(); // Clear events

      await registry.unregister("test-provider");

      const events = bus.getEvents();
      const unregisteredEvent = events.find(e => e.topic === "provider.unregistered");
      expect(unregisteredEvent).toBeDefined();
    });

    it("should throw error when unregistering non-existent provider", async () => {
      await expect(registry.unregister("non-existent")).rejects.toThrow(/not found/i);
    });
  });

  describe("Concurrency Limit Enforcement", () => {
    it("should allow execution up to concurrency limit", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 3,
        healthCheckIntervalMs: 30000,
      };

      await registry.register(registration, adapter);

      // Check and increment up to limit
      registry.checkConcurrencyLimit("test-provider");
      registry.incrementInFlight("test-provider");

      registry.checkConcurrencyLimit("test-provider");
      registry.incrementInFlight("test-provider");

      registry.checkConcurrencyLimit("test-provider");
      registry.incrementInFlight("test-provider");

      // Now at limit
      expect(() => registry.checkConcurrencyLimit("test-provider")).toThrow(/concurrency limit/i);
    });

    it("should reject execution exceeding concurrency limit", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 1,
        healthCheckIntervalMs: 30000,
      };

      await registry.register(registration, adapter);

      registry.checkConcurrencyLimit("test-provider");
      registry.incrementInFlight("test-provider");

      expect(() => registry.checkConcurrencyLimit("test-provider")).toThrow(
        NormalizedProviderError
      );
    });

    it("should allow reuse of slots after decrement", async () => {
      const adapter = new TestProvider();
      const registration: ProviderRegistration<ACPConfig> = {
        id: "test-provider",
        type: "acp",
        config: { apiKey: "test-key", model: "claude-3-sonnet" },
        workspaceId: "ws-1",
        concurrencyLimit: 1,
        healthCheckIntervalMs: 30000,
      };

      await registry.register(registration, adapter);

      registry.checkConcurrencyLimit("test-provider");
      registry.incrementInFlight("test-provider");

      expect(() => registry.checkConcurrencyLimit("test-provider")).toThrow();

      registry.decrementInFlight("test-provider");

      // Should not throw now
      registry.checkConcurrencyLimit("test-provider");
    });
  });

  describe("Filtering by Type", () => {
    it("should list providers by type", async () => {
      const acpAdapter = new TestProvider();
      const mcpAdapter = new TestProvider();

      await registry.register(
        {
          id: "acp-provider",
          type: "acp",
          config: { apiKey: "test", model: "claude-3-sonnet" },
          workspaceId: "ws-1",
          concurrencyLimit: 10,
          healthCheckIntervalMs: 30000,
        },
        acpAdapter
      );

      await registry.register(
        {
          id: "mcp-provider",
          type: "mcp",
          config: { apiKey: "test", model: "claude-3-sonnet" },
          workspaceId: "ws-1",
          concurrencyLimit: 10,
          healthCheckIntervalMs: 30000,
        },
        mcpAdapter
      );

      const acpProviders = registry.listByType("acp");
      const mcpProviders = registry.listByType("mcp");

      expect(acpProviders).toHaveLength(1);
      expect(mcpProviders).toHaveLength(1);
    });
  });

  describe("Filtering by Workspace", () => {
    it("should list providers by workspace", async () => {
      const adapter1 = new TestProvider();
      const adapter2 = new TestProvider();

      await registry.register(
        {
          id: "provider-ws1",
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
          id: "provider-ws2",
          type: "acp",
          config: { apiKey: "test", model: "claude-3-sonnet" },
          workspaceId: "ws-2",
          concurrencyLimit: 10,
          healthCheckIntervalMs: 30000,
        },
        adapter2
      );

      const ws1Providers = registry.listByWorkspace("ws-1");
      const ws2Providers = registry.listByWorkspace("ws-2");

      expect(ws1Providers).toHaveLength(1);
      expect(ws2Providers).toHaveLength(1);
    });
  });
});
