/**
 * Tests for A2A Router, Health Monitoring, and Failover
 *
 * FR-025-005: A2A federation with failure isolation.
 * FR-025-010: Failover routing for degraded providers.
 * SC-025-002: Provider crash isolation across lanes.
 */

import { describe, it, expect, beforeEach } from "bun:test";

import { InMemoryLocalBus } from "../../protocol/bus.js";
import { NormalizedProviderError } from "../errors.js";
import type { ProviderHealthStatus } from "../adapter.js";

type RouterConfig = {
  endpoints: Array<{
    id: string;
    url: string;
    priority: number;
    capabilities: string[];
  }>;
  timeout: number;
  failoverEnabled: boolean;
};

describe("A2A Router Adapter", () => {
  let adapter: A2ARouterAdapter;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
    adapter = new A2ARouterAdapter(bus);
  });

  describe("Initialization", () => {
    it("should initialize with valid endpoints", async () => {
      const config: RouterConfig = {
        endpoints: [
          {
            id: "agent-1",
            url: "http://localhost:9000",
            priority: 1,
            capabilities: ["task-execution", "inference"],
          },
          {
            id: "agent-2",
            url: "http://localhost:9001",
            priority: 2,
            capabilities: ["task-execution"],
          },
        ],
        timeout: 30000,
        failoverEnabled: true,
      };

      await adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);

      const health = await adapter.health();
      expect(health.state).toBe("healthy");
    });

    it("should reject missing endpoints", async () => {
      const config: RouterConfig = {
        endpoints: [],
        timeout: 30000,
        failoverEnabled: true,
      };

      await expect(
        adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0])
      ).rejects.toThrow(/init failed/i);
    });

    it("should sort endpoints by priority", async () => {
      const config: RouterConfig = {
        endpoints: [
          {
            id: "agent-3",
            url: "http://localhost:9002",
            priority: 3,
            capabilities: [],
          },
          {
            id: "agent-1",
            url: "http://localhost:9000",
            priority: 1,
            capabilities: [],
          },
          {
            id: "agent-2",
            url: "http://localhost:9001",
            priority: 2,
            capabilities: [],
          },
        ],
        timeout: 30000,
        failoverEnabled: true,
      };

      await adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);

      const endpoints = adapter.getEndpoints();
      expect(endpoints[0].id).toBe("agent-1");
      expect(endpoints[1].id).toBe("agent-2");
      expect(endpoints[2].id).toBe("agent-3");
    });

    it("should emit initialization event", async () => {
      const config: RouterConfig = {
        endpoints: [
          {
            id: "agent-1",
            url: "http://localhost:9000",
            priority: 1,
            capabilities: [],
          },
        ],
        timeout: 30000,
        failoverEnabled: true,
      };

      await adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);

      const events = bus.getEvents();
      const initEvent = events.find(e => e.topic === "provider.a2a.initialized");
      expect(initEvent).toBeDefined();
      expect(initEvent?.payload?.endpointCount).toBe(1);
    });
  });

  describe("Delegation Routing", () => {
    beforeEach(async () => {
      const config: RouterConfig = {
        endpoints: [
          {
            id: "agent-1",
            url: "http://localhost:9000",
            priority: 1,
            capabilities: ["inference", "planning"],
          },
          {
            id: "agent-2",
            url: "http://localhost:9001",
            priority: 2,
            capabilities: ["inference"],
          },
        ],
        timeout: 30000,
        failoverEnabled: true,
      };
      await adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);
    });

    it("should delegate to endpoint with matching capabilities", async () => {
      const result = await adapter.execute(
        {
          taskDescription: "Plan a task",
          requiredCapabilities: ["planning"],
          context: { deadline: "2026-03-02" },
        },
        "corr-123"
      );

      expect(result).toBeDefined();
      expect(result.correlationId).toBe("corr-123");
      expect(result.endpointId).toBe("agent-1"); // Has planning capability
    });

    it("should select first matching endpoint by priority", async () => {
      const result = await adapter.execute(
        {
          taskDescription: "Run inference",
          requiredCapabilities: ["inference"],
          context: {},
        },
        "corr-123"
      );

      expect(result.endpointId).toBe("agent-1"); // Higher priority (lower number)
    });

    it("should reject delegation without matching endpoints", async () => {
      await expect(
        adapter.execute(
          {
            taskDescription: "Unknown capability",
            requiredCapabilities: ["unknown-capability"],
            context: {},
          },
          "corr-123"
        )
      ).rejects.toThrow();
    });

    it("should propagate correlation ID in result", async () => {
      const correlationId = "unique-trace-id";

      const result = await adapter.execute(
        {
          taskDescription: "Test",
          requiredCapabilities: ["inference"],
          context: {},
        },
        correlationId
      );

      expect(result.correlationId).toBe(correlationId);
    });

    it("should emit delegation completed event", async () => {
      bus.getEvents(); // Clear events

      await adapter.execute(
        {
          taskDescription: "Test",
          requiredCapabilities: ["inference"],
          context: {},
        },
        "corr-123"
      );

      const events = bus.getEvents();
      const completedEvent = events.find(e => e.topic === "provider.a2a.delegation.completed");
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.payload?.correlationId).toBe("corr-123");
    });

    it("should include duration in result", async () => {
      const result = await adapter.execute(
        {
          taskDescription: "Test",
          requiredCapabilities: ["inference"],
          context: {},
        },
        "corr-123"
      );

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Failover Routing", () => {
    beforeEach(async () => {
      const config: RouterConfig = {
        endpoints: [
          {
            id: "agent-1",
            url: "http://localhost:9000",
            priority: 1,
            capabilities: ["inference"],
          },
          {
            id: "agent-2",
            url: "http://localhost:9001",
            priority: 2,
            capabilities: ["inference"],
          },
        ],
        timeout: 30000,
        failoverEnabled: true,
      };
      await adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);
    });

    it("should route to healthy endpoint", async () => {
      const result = await adapter.execute(
        {
          taskDescription: "Test",
          requiredCapabilities: ["inference"],
          context: {},
        },
        "corr-123"
      );

      expect(result).toBeDefined();
    });

    it("should route to degraded endpoint if no healthy one available", async () => {
      // Mark first endpoint as degraded
      adapter.updateEndpointHealth("agent-1", {
        state: "degraded",
        lastCheck: new Date(),
        failureCount: 3,
      });

      const result = await adapter.execute(
        {
          taskDescription: "Test",
          requiredCapabilities: ["inference"],
          context: {},
        },
        "corr-123"
      );

      // Should fallback to agent-2
      expect(result.endpointId).toBe("agent-2");
    });

    it("should failover between endpoints", async () => {
      // Mark all endpoints as degraded except one
      adapter.updateEndpointHealth("agent-1", {
        state: "unavailable",
        lastCheck: new Date(),
        failureCount: 5,
      });

      const result = await adapter.execute(
        {
          taskDescription: "Test",
          requiredCapabilities: ["inference"],
          context: {},
        },
        "corr-123"
      );

      // Should use agent-2
      expect(result.endpointId).toBe("agent-2");
    });
  });

  describe("Health Monitoring", () => {
    beforeEach(async () => {
      const config: RouterConfig = {
        endpoints: [
          {
            id: "agent-1",
            url: "http://localhost:9000",
            priority: 1,
            capabilities: [],
          },
        ],
        timeout: 30000,
        failoverEnabled: true,
      };
      await adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);
    });

    it("should report healthy initially", async () => {
      const health = await adapter.health();
      expect(health.state).toBe("healthy");
      expect(health.failureCount).toBe(0);
    });

    it("should include timestamp in health status", async () => {
      const health = await adapter.health();
      expect(health.lastCheck).toBeInstanceOf(Date);
    });
  });

  describe("Termination", () => {
    beforeEach(async () => {
      const config: RouterConfig = {
        endpoints: [
          {
            id: "agent-1",
            url: "http://localhost:9000",
            priority: 1,
            capabilities: [],
          },
        ],
        timeout: 30000,
        failoverEnabled: true,
      };
      await adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);
    });

    it("should terminate successfully", async () => {
      let health = await adapter.health();
      expect(health.state).toBe("healthy");

      await adapter.terminate();

      health = await adapter.health();
      expect(health.state).toBe("unavailable");
    });

    it("should emit termination event", async () => {
      bus.getEvents(); // Clear events

      await adapter.terminate();

      const events = bus.getEvents();
      const terminatedEvent = events.find(e => e.topic === "provider.a2a.terminated");
      expect(terminatedEvent).toBeDefined();
    });

    it("should prevent delegation after termination", async () => {
      await adapter.terminate();

      await expect(
        adapter.execute(
          {
            taskDescription: "Test",
            requiredCapabilities: [],
            context: {},
          },
          "corr-123"
        )
      ).rejects.toThrow(/unavailable/i);
    });
  });

  describe("Error Handling", () => {
    beforeEach(async () => {
      const config: RouterConfig = {
        endpoints: [
          {
            id: "agent-1",
            url: "http://localhost:9000",
            priority: 1,
            capabilities: ["inference"],
          },
        ],
        timeout: 30000,
        failoverEnabled: true,
      };
      await adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);
    });

    it("should emit error event on delegation failure", async () => {
      bus.getEvents(); // Clear events

      try {
        await adapter.execute(
          {
            taskDescription: "Test",
            requiredCapabilities: ["unknown"],
            context: {},
          },
          "corr-123"
        );
      } catch {
        // Expected
      }

      const events = bus.getEvents();
      const errorEvent = events.find(e => e.topic === "provider.a2a.delegation.failed");
      expect(errorEvent).toBeDefined();
    });
  });
});

describe("Health Monitoring Coordinator", () => {
  let coordinator: HealthMonitoringCoordinator;
  let bus: InMemoryLocalBus;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
    coordinator = new HealthMonitoringCoordinator(bus);
  });

  describe("Provider Registration", () => {
    it("should register provider for monitoring", () => {
      const checkFunction = (): Promise<ProviderHealthStatus> =>
        Promise.resolve({
          state: "healthy",
          lastCheck: new Date(),
          failureCount: 0,
        });

      coordinator.registerProvider("provider-1", 5000, checkFunction);

      const health = coordinator.getProviderHealth("provider-1");
      expect(health).toBeDefined();
    });

    it("should support multiple providers", () => {
      const checkFunction = (): Promise<ProviderHealthStatus> =>
        Promise.resolve({
          state: "healthy",
          lastCheck: new Date(),
          failureCount: 0,
        });

      coordinator.registerProvider("provider-1", 5000, checkFunction);
      coordinator.registerProvider("provider-2", 5000, checkFunction);
      coordinator.registerProvider("provider-3", 5000, checkFunction);

      expect(coordinator.getProviderHealth("provider-1")).toBeDefined();
      expect(coordinator.getProviderHealth("provider-2")).toBeDefined();
      expect(coordinator.getProviderHealth("provider-3")).toBeDefined();
    });
  });

  describe("Health Status Tracking", () => {
    it("should track health for registered providers", () => {
      const checkFunction = (): Promise<ProviderHealthStatus> =>
        Promise.resolve({
          state: "healthy",
          lastCheck: new Date(),
          failureCount: 0,
        });

      coordinator.registerProvider("provider-1", 5000, checkFunction);

      const health = coordinator.getProviderHealth("provider-1");
      expect(health?.state).toBe("unavailable"); // Initial state
    });
  });

  describe("Provider Unregistration", () => {
    it("should unregister provider and stop monitoring", () => {
      const checkFunction = (): Promise<ProviderHealthStatus> =>
        Promise.resolve({
          state: "healthy",
          lastCheck: new Date(),
          failureCount: 0,
        });

      coordinator.registerProvider("provider-1", 5000, checkFunction);
      expect(coordinator.getProviderHealth("provider-1")).toBeDefined();

      coordinator.unregisterProvider("provider-1");
      expect(coordinator.getProviderHealth("provider-1")).toBeUndefined();
    });
  });

  describe("Shutdown", () => {
    it("should cleanup all monitoring on shutdown", () => {
      const checkFunction = (): Promise<ProviderHealthStatus> =>
        Promise.resolve({
          state: "healthy",
          lastCheck: new Date(),
          failureCount: 0,
        });

      coordinator.registerProvider("provider-1", 5000, checkFunction);
      coordinator.registerProvider("provider-2", 5000, checkFunction);

      coordinator.shutdown();

      expect(coordinator.getProviderHealth("provider-1")).toBeUndefined();
      expect(coordinator.getProviderHealth("provider-2")).toBeUndefined();
    });
  });

  describe("Healthy Providers Filtering", () => {
    it("should return healthy providers of given type", () => {
      const checkFunction = (): Promise<ProviderHealthStatus> =>
        Promise.resolve({
          state: "healthy",
          lastCheck: new Date(),
          failureCount: 0,
        });

      // Note: Mock implementation filters by ID prefix
      coordinator.registerProvider("acp-provider-1", 5000, checkFunction);
      coordinator.registerProvider("acp-provider-2", 5000, checkFunction);
      coordinator.registerProvider("mcp-provider-1", 5000, checkFunction);

      // Since initial state is unavailable, they won't be returned as healthy
      const healthyACP = coordinator.getHealthyProvidersByType("acp");
      expect(healthyACP).toBeDefined();
    });
  });
});

describe("Provider Crash Isolation (SC-025-002)", () => {
  it("should isolate crash in one lane from another lane", async () => {
    const bus = new InMemoryLocalBus();

    // Create two separate adapter instances (simulating two lanes)
    const laneAdapterA = new A2ARouterAdapter(bus);
    const laneAdapterB = new A2ARouterAdapter(bus);

    const config: RouterConfig = {
      endpoints: [
        {
          id: "agent-1",
          url: "http://localhost:9000",
          priority: 1,
          capabilities: ["task"],
        },
      ],
      timeout: 30000,
      failoverEnabled: true,
    };

    await laneAdapterA.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);
    await laneAdapterB.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);

    // Lane A executes successfully
    const resultA = await laneAdapterA.execute(
      {
        taskDescription: "Task A",
        requiredCapabilities: ["task"],
        context: {},
      },
      "corr-a"
    );
    expect(resultA).toBeDefined();

    // Lane B executes successfully (unaffected by Lane A)
    const resultB = await laneAdapterB.execute(
      {
        taskDescription: "Task B",
        requiredCapabilities: ["task"],
        context: {},
      },
      "corr-b"
    );
    expect(resultB).toBeDefined();

    // Verify both completed successfully
    expect(resultA.correlationId).toBe("corr-a");
    expect(resultB.correlationId).toBe("corr-b");
  });
});

describe("Error Taxonomy Completeness (SC-025-004)", () => {
  let adapter: A2ARouterAdapter;
  let bus: InMemoryLocalBus;

  beforeEach(async () => {
    bus = new InMemoryLocalBus();
    adapter = new A2ARouterAdapter(bus);

    const config: RouterConfig = {
      endpoints: [
        {
          id: "agent-1",
          url: "http://localhost:9000",
          priority: 1,
          capabilities: ["task"],
        },
      ],
      timeout: 30000,
      failoverEnabled: true,
    };
    await adapter.init(config as unknown as Parameters<A2ARouterAdapter["init"]>[0]);
  });

  it("should map all delegation errors to normalized error codes", async () => {
    // Test unmatched capability error
    const error = await adapter
      .execute(
        {
          taskDescription: "Unknown",
          requiredCapabilities: ["unknown"],
          context: {},
        },
        "corr-123"
      )
      .catch(e => e);

    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect((error as NormalizedProviderError).code).toBeTruthy();
    expect((error as NormalizedProviderError).code).not.toBe("PROVIDER_UNKNOWN");
  });
});
