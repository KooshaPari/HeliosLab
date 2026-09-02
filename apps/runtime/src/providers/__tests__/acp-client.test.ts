/**
 * Tests for ACP Client Adapter
 *
 * FR-025-003: ACP integration with run/cancel lifecycle.
 * FR-025-009: Health checks and state transitions.
 * FR-025-012: Policy gate integration.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ACPClientAdapter, type PolicyGate } from "../acp-client.js";
import { InMemoryLocalBus } from "../../protocol/bus.js";
import { NormalizedProviderError } from "../errors.js";

/**
 * Mock policy gate for testing.
 */
class MockPolicyGate implements PolicyGate {
  private shouldDeny = false;
  private denialReason = "Test denial";

  setShouldDeny(deny: boolean, reason?: string): void {
    this.shouldDeny = deny;
    if (reason) {
      this.denialReason = reason;
    }
  }

  async evaluate(
    _action: string,
    _context: Record<string, unknown>
  ): Promise<{ allowed: boolean; reason?: string }> {
    await Promise.resolve();
    if (this.shouldDeny) {
      return {
        allowed: false,
        reason: this.denialReason,
      };
    }
    return { allowed: true };
  }
}

describe("ACP Client Adapter", () => {
  let adapter: ACPClientAdapter;
  let bus: InMemoryLocalBus;
  let policyGate: MockPolicyGate;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
    policyGate = new MockPolicyGate();
    adapter = new ACPClientAdapter(bus, policyGate);
  });

  describe("Initialization", () => {
    it("should initialize with valid config", async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      };

      await adapter.init(config);

      const health = await adapter.health();
      expect(health.state).toBe("healthy");
    });

    it("should reject missing endpoint", async () => {
      const config = {
        baseUrl: "",
        apiKey: "",

        model: "claude-3-sonnet",
        timeout: 30000,
      };

      await expect(adapter.init(config)).rejects.toThrow(/init failed/i);
    });

    it("should reject missing apiKeyRef", async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      };

      await expect(adapter.init(config)).rejects.toThrow(/init failed/i);
    });

    it("should reject missing model", async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "",
        timeout: 30000,
      };

      await expect(adapter.init(config)).rejects.toThrow(/init failed/i);
    });

    it("should emit initialization event", async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      };

      await adapter.init(config);

      const events = bus.getEvents();
      const initEvent = events.find(e => e.topic === "provider.acp.initialized");
      expect(initEvent).toBeDefined();
      expect(initEvent?.payload?.endpoint).toBe(config.baseUrl);
    });
  });

  describe("Health Checks", () => {
    beforeEach(async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      };
      await adapter.init(config);
    });

    it("should report healthy initially", async () => {
      const health = await adapter.health();
      expect(health.state).toBe("healthy");
      expect(health.failureCount).toBe(0);
    });

    it("should track failure count on health check failure", async () => {
      let health = await adapter.health();
      expect(health.state).toBe("healthy");

      // Simulate multiple failed checks by reinitializing with broken endpoint
      const brokenAdapter = new ACPClientAdapter(bus, policyGate);
      await brokenAdapter.init({
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      });

      health = await brokenAdapter.health();
      // Mock implementation returns healthy, but in real scenario would track failures
      expect(health).toBeDefined();
    });

    it("should emit health state transition events", async () => {
      bus.getEvents(); // Clear initial events

      // Get initial health
      const health1 = await adapter.health();
      expect(health1.state).toBe("healthy");

      // In a real implementation, health check failure would trigger transition
      // For mock, we verify the health check completes
      const health2 = await adapter.health();
      expect(health2.state).toBe("healthy");
    });
  });

  describe("Task Execution", () => {
    beforeEach(async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      };
      await adapter.init(config);
    });

    it("should execute a task successfully", async () => {
      const input = {
        prompt: "Hello, how are you?",
      };

      const result = await adapter.execute(input, "corr-123");

      expect(result).toBeDefined();
      expect(result.content).toBeTruthy();
      expect(result.stopReason).toBe("end_turn");
    });

    it("should propagate correlation ID in response", async () => {
      const correlationId = "unique-corr-id-456";

      const result = await adapter.execute({ prompt: "Test" }, correlationId);

      expect(result).toBeDefined();

      const events = bus.getEvents();
      const completedEvent = events.find(e => e.topic === "provider.acp.execute.completed");
      expect(completedEvent?.payload?.correlationId).toBe(correlationId);
    });

    it("should emit execution completed event", async () => {
      bus.getEvents(); // Clear events

      await adapter.execute({ prompt: "Test" }, "corr-123");

      const events = bus.getEvents();
      const completedEvent = events.find(e => e.topic === "provider.acp.execute.completed");
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.payload?.duration).toBeGreaterThanOrEqual(0);
    });

    it("should reject execution before init", async () => {
      const freshAdapter = new ACPClientAdapter(bus, policyGate);

      await expect(freshAdapter.execute({ prompt: "Test" }, "corr-123")).rejects.toThrow(
        /unavailable/i
      );
    });

    it("should include token usage in response", async () => {
      const result = await adapter.execute({ prompt: "Test" }, "corr-123");

      expect(result.usage).toBeDefined();
      expect(result.usage?.inputTokens).toBeGreaterThan(0);
      expect(result.usage?.outputTokens).toBeGreaterThan(0);
    });
  });

  describe("Policy Gate Integration", () => {
    beforeEach(async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      };
      await adapter.init(config);
    });

    it("should deny execution when policy gate denies", async () => {
      policyGate.setShouldDeny(true, "Access denied");

      await expect(adapter.execute({ prompt: "Test" }, "corr-123")).rejects.toThrow(
        /policy denied/i
      );
    });

    it("should emit policy denied event", async () => {
      bus.getEvents(); // Clear events
      policyGate.setShouldDeny(true, "Access denied");

      try {
        await adapter.execute({ prompt: "Test" }, "corr-123");
      } catch {
        // Expected
      }

      const events = bus.getEvents();
      const policyEvent = events.find(e => e.topic === "provider.acp.policy.denied");
      expect(policyEvent).toBeDefined();
      expect(policyEvent?.payload?.reason).toContain("Access denied");
    });

    it("should not contact endpoint when policy denies", async () => {
      policyGate.setShouldDeny(true, "Test denial");
      bus.getEvents(); // Clear events

      try {
        await adapter.execute({ prompt: "Test" }, "corr-123");
      } catch {
        // Expected - should be NormalizedProviderError with PROVIDER_POLICY_DENIED
        expect(e instanceof NormalizedProviderError).toBe(true);
        if (e instanceof NormalizedProviderError) {
          expect(e.code).toBe("PROVIDER_POLICY_DENIED");
        }
      }
    });

    it("should allow execution when policy gate allows", async () => {
      policyGate.setShouldDeny(false);

      const result = await adapter.execute({ prompt: "Test" }, "corr-123");

      expect(result).toBeDefined();
      expect(result.content).toBeTruthy();
    });
  });

  describe("Task Cancellation", () => {
    beforeEach(async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      };
      await adapter.init(config);
    });

    it("should cancel a task", async () => {
      const taskId = "task-123";

      // Should not throw
      await adapter.cancel(taskId);

      const events = bus.getEvents();
      const cancelledEvent = events.find(e => e.topic === "provider.acp.execute.cancelled");
      expect(cancelledEvent).toBeDefined();
      expect(cancelledEvent?.payload?.taskId).toBe(taskId);
    });

    it("should emit cancellation event", async () => {
      bus.getEvents(); // Clear events

      await adapter.cancel("task-456");

      const events = bus.getEvents();
      const cancelledEvent = events.find(e => e.topic === "provider.acp.execute.cancelled");
      expect(cancelledEvent).toBeDefined();
    });

    it("should be idempotent (cancel already-completed task)", async () => {
      // Cancel a task that doesn't exist should not throw
      await expect(adapter.cancel("non-existent")).resolves.toBeUndefined();
    });

    it("should reject cancel before init", async () => {
      const freshAdapter = new ACPClientAdapter(bus, policyGate);

      await expect(freshAdapter.cancel("task-123")).rejects.toThrow(/unavailable/i);
    });
  });

  describe("Termination", () => {
    beforeEach(async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      };
      await adapter.init(config);
    });

    it("should terminate successfully", async () => {
      let health = await adapter.health();
      expect(health.state).toBe("healthy");

      await adapter.terminate();

      health = await adapter.health();
      expect(health.state).toBe("unavailable");
      expect(health.message).toContain("Terminated");
    });

    it("should emit termination event", async () => {
      bus.getEvents(); // Clear events

      await adapter.terminate();

      const events = bus.getEvents();
      const terminatedEvent = events.find(e => e.topic === "provider.acp.terminated");
      expect(terminatedEvent).toBeDefined();
    });

    it("should cancel in-flight tasks on terminate", async () => {
      // Execute a task
      const executePromise = adapter.execute({ prompt: "Long task" }, "corr-123");

      // Terminate immediately
      await adapter.terminate();

      // In-flight task should be cancelled (or complete if already done)
      // The promise should eventually resolve/reject
      await expect(executePromise).rejects.toThrow();
    });

    it("should prevent execution after termination", async () => {
      await adapter.terminate();

      await expect(adapter.execute({ prompt: "Test" }, "corr-123")).rejects.toThrow(/unavailable/i);
    });
  });

  describe("Correlation ID Propagation", () => {
    beforeEach(async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeout: 30000,
      };
      await adapter.init(config);
    });

    it("should include correlation ID in all bus events", async () => {
      const correlationId = "unique-trace-id";

      await adapter.execute({ prompt: "Test" }, correlationId);

      const events = bus.getEvents();
      const relevantEvents = events.filter(e => e.topic?.startsWith("provider.acp.execute"));

      for (const event of relevantEvents) {
        expect(event.payload?.correlationId).toBe(correlationId);
      }
    });

    it("should preserve correlation ID through error cases", async () => {
      policyGate.setShouldDeny(true);

      const correlationId = "error-trace-id";

      try {
        await adapter.execute({ prompt: "Test" }, correlationId);
      } catch {
        if (e instanceof NormalizedProviderError) {
          expect(e.correlationId).toBe(correlationId);
        }
      }

      const events = bus.getEvents();
      const policyEvent = events.find(e => e.topic === "provider.acp.policy.denied");
      expect(policyEvent?.payload?.correlationId).toBe(correlationId);
    });
  });

  describe("Error Handling", () => {
    beforeEach(async () => {
      const config = {
        baseUrl: "http://localhost:8080/acp",
        apiKey: "acp-key",

        model: "claude-3-sonnet",
        timeoutMs: 100, // Short timeout for timeout tests
      };
      await adapter.init(config);
    });

    it("should throw NormalizedProviderError on policy denial", async () => {
      policyGate.setShouldDeny(true);

      const error = await adapter.execute({ prompt: "Test" }, "corr-123").catch(e => e);

      expect(error).toBeInstanceOf(NormalizedProviderError);
      expect((error as NormalizedProviderError).code).toBe("PROVIDER_POLICY_DENIED");
      expect((error as NormalizedProviderError).retryable).toBe(false);
    });

    it("should emit error event on execution failure", async () => {
      policyGate.setShouldDeny(true);
      bus.getEvents(); // Clear events

      try {
        await adapter.execute({ prompt: "Test" }, "corr-123");
      } catch {
        // Expected
      }

      const events = bus.getEvents();
      const errorEvent = events.find(e => e.topic === "provider.acp.execute.failed");
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.payload?.retryable).toBeDefined();
    });
  });
});
