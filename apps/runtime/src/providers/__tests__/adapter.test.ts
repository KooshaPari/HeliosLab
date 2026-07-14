/**
 * Tests for ProviderAdapter interface and base class
 *
 * FR-025-001: Typed adapter interface with lifecycle methods.
 * Traces to: FR-MVP-014 (Anthropic API), FR-MVP-015 (local Apple), FR-MVP-016 (local NVIDIA), FR-MVP-018 (switch providers)
 */

import { describe, it, expect } from "bun:test";

import { BaseProviderAdapter } from "../adapter.js";
import type { ACPConfig, ACPExecuteInput, ACPExecuteOutput } from "../adapter.js";

/**
 * Mock provider implementation for testing.
 * Implements the ProviderAdapter interface with configurable behavior.
 */
class MockProvider extends BaseProviderAdapter<ACPConfig, ACPExecuteInput, ACPExecuteOutput> {
  private isHealthy = true;
  private isInitialized = false;
  private failInit = false;
  private failHealth = false;
  private failExecute = false;

  constructor(options?: { failInit?: boolean; failHealth?: boolean; failExecute?: boolean }) {
    super();
    this.failInit = options?.failInit ?? false;
    this.failHealth = options?.failHealth ?? false;
    this.failExecute = options?.failExecute ?? false;
  }

  init(config: ACPConfig): Promise<void> {
    if (this.failInit) {
      return Promise.reject(new Error("Init failed"));
    }

    this.config = config;
    this.isInitialized = true;
    this.isHealthy = true;
    this.updateHealthStatus({
      state: "healthy",
      lastCheck: new Date(),
      failureCount: 0,
    });
    return Promise.resolve();
  }

  health(): Promise<ProviderHealthStatus> {
    if (this.failHealth) {
      return Promise.resolve({
        state: "unavailable",
        lastCheck: new Date(),
        failureCount: 3,
        message: "Health check failed",
      });
    }

    if (!this.isInitialized) {
      return Promise.resolve({
        state: "unavailable",
        lastCheck: new Date(),
        failureCount: 0,
        message: "Not initialized",
      });
    }

    return Promise.resolve({
      state: this.isHealthy ? "healthy" : "degraded",
      lastCheck: new Date(),
      failureCount: 0,
    });
  }

  execute(input: ACPExecuteInput, _correlationId: string): Promise<ACPExecuteOutput> {
    if (this.failExecute) {
      return Promise.reject(new Error("Execute failed"));
    }

    if (!this.isInitialized) {
      return Promise.reject(new Error("Provider not initialized"));
    }

    return Promise.resolve({
      content: `Mock response to: ${input.prompt}`,
      stopReason: "end_turn",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
      },
    });
  }

  terminate(): Promise<void> {
    this.isInitialized = false;
    this.isHealthy = false;
    this.updateHealthStatus({
      state: "unavailable",
      lastCheck: new Date(),
      failureCount: 0,
      message: "Terminated",
    });
    return Promise.resolve();
  }

  // Test helpers
  setHealthy(healthy: boolean): void {
    this.isHealthy = healthy;
  }
}

describe("ProviderAdapter Interface", () => {
  it("should allow a mock provider to implement the interface", () => {
    const provider = new MockProvider();

    // Verify it implements ProviderAdapter
    expect(provider).toBeDefined();
    expect(typeof provider.init).toBe("function");
    expect(typeof provider.health).toBe("function");
    expect(typeof provider.execute).toBe("function");
    expect(typeof provider.terminate).toBe("function");
  });

  describe("Lifecycle Methods", () => {
    it("should initialize and pass health check", async () => {
      const provider = new MockProvider();

      const config: ACPConfig = {
        apiKey: "test-key",
        model: "claude-3-sonnet",
      };

      // Initialize
      await provider.init(config);

      // Check health
      const health = await provider.health();
      expect(health.state).toBe("healthy");
      expect(health.failureCount).toBe(0);
    });

    it("should execute a task after initialization", async () => {
      const provider = new MockProvider();

      const config: ACPConfig = {
        apiKey: "test-key",
        model: "claude-3-sonnet",
      };

      await provider.init(config);

      const result = await provider.execute({ prompt: "Hello, world!" }, "correlation-123");

      expect(result.content).toContain("Mock response");
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage?.inputTokens).toBeGreaterThan(0);
    });

    it("should terminate and release resources", async () => {
      const provider = new MockProvider();

      const config: ACPConfig = {
        apiKey: "test-key",
        model: "claude-3-sonnet",
      };

      await provider.init(config);

      // Verify health is good
      let health = await provider.health();
      expect(health.state).toBe("healthy");

      // Terminate
      await provider.terminate();

      // Verify health is unavailable
      health = await provider.health();
      expect(health.state).toBe("unavailable");
    });
  });

  describe("Error Handling", () => {
    it("should handle init failure", async () => {
      const provider = new MockProvider({ failInit: true });

      const config: ACPConfig = {
        apiKey: "test-key",
        model: "claude-3-sonnet",
      };

      await expect(provider.init(config)).rejects.toThrow("Init failed");
    });

    it("should handle health check failure", async () => {
      const provider = new MockProvider({ failHealth: true });

      const config: ACPConfig = {
        apiKey: "test-key",
        model: "claude-3-sonnet",
      };

      await provider.init(config);

      const health = await provider.health();
      expect(health.state).toBe("unavailable");
      expect(health.failureCount).toBeGreaterThan(0);
    });

    it("should handle execute failure", async () => {
      const provider = new MockProvider({ failExecute: true });

      const config: ACPConfig = {
        apiKey: "test-key",
        model: "claude-3-sonnet",
      };

      await provider.init(config);

      await expect(provider.execute({ prompt: "Hello" }, "correlation-123")).rejects.toThrow(
        "Execute failed"
      );
    });

    it("should prevent execute before init", async () => {
      const provider = new MockProvider();

      await expect(provider.execute({ prompt: "Hello" }, "correlation-123")).rejects.toThrow(
        "not initialized"
      );
    });
  });

  describe("Generic Type Parameters", () => {
    it("should support specialized config, input, and output types", async () => {
      // This test verifies that generic type parameters work correctly
      // without requiring type casts.

      interface CustomConfig {
        apiKey: string;
        customField: string;
      }

      interface CustomInput {
        query: string;
        options: { timeout: number };
      }

      interface CustomOutput {
        answer: string;
        metadata: { score: number };
      }

      class CustomProvider extends BaseProviderAdapter<CustomConfig, CustomInput, CustomOutput> {
        init(config: CustomConfig): Promise<void> {
          expect(config.customField).toBeDefined();
          return Promise.resolve();
        }

        health(): Promise<ProviderHealthStatus> {
          return Promise.resolve({
            state: "healthy",
            lastCheck: new Date(),
            failureCount: 0,
          });
        }

        execute(input: CustomInput, _correlationId: string): Promise<CustomOutput> {
          expect(input.options.timeout).toBeGreaterThan(0);
          return Promise.resolve({
            answer: "Custom answer",
            metadata: { score: 0.95 },
          });
        }

        terminate(): Promise<void> {
          return Promise.resolve();
        }
      }

      const provider = new CustomProvider();

      const config: CustomConfig = {
        apiKey: "test",
        customField: "value",
      };

      await provider.init(config);

      const output = await provider.execute(
        { query: "test", options: { timeout: 5000 } },
        "correlation-123"
      );

      expect(output.answer).toBe("Custom answer");
      expect(output.metadata.score).toBeCloseTo(0.95);

      await provider.terminate();
    });
  });

  describe("Health Status Tracking", () => {
    it("should track health status transitions", async () => {
      const provider = new MockProvider();

      const config: ACPConfig = {
        apiKey: "test-key",
        model: "claude-3-sonnet",
      };

      await provider.init(config);

      // Initially healthy
      let health = await provider.health();
      expect(health.state).toBe("healthy");

      // Mark as degraded
      provider.setHealthy(false);
      health = await provider.health();
      expect(health.state).toBe("degraded");

      // Restore to healthy
      provider.setHealthy(true);
      health = await provider.health();
      expect(health.state).toBe("healthy");
    });

    it("should include timestamp in health status", async () => {
      const provider = new MockProvider();

      const config: ACPConfig = {
        apiKey: "test-key",
        model: "claude-3-sonnet",
      };

      await provider.init(config);

      const health = await provider.health();
      expect(health.lastCheck).toBeInstanceOf(Date);
      expect(health.lastCheck.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("Correlation ID Propagation", () => {
    it("should accept correlation ID in execute method", async () => {
      const provider = new MockProvider();

      const config: ACPConfig = {
        apiKey: "test-key",
        model: "claude-3-sonnet",
      };

      await provider.init(config);

      const correlationId = "unique-correlation-id-12345";

      // Should not throw when accepting correlation ID
      const result = await provider.execute({ prompt: "Test" }, correlationId);

      expect(result).toBeDefined();
    });
  });
});
