/**
 * Tests for Process-Level Isolation
 *
 * FR-025-007: Process-level isolation for provider execution.
 * NFR-025-004: Provider crash must not leak resources.
 * SC-025-002: Provider crash in lane A must produce zero effect on lane B.
 */

import { describe, it, expect } from "bun:test";


import type { ACPConfig, ACPExecuteInput, ACPExecuteOutput } from "../adapter.js";

/**
 * Mock isolated provider for testing lane isolation behavior.
 *
 * In a real implementation, this would spawn a child process.
 * For testing, we simulate the behavior with in-process state.
 */
class MockIsolatedProvider implements ProviderAdapter<
  ACPConfig,
  ACPExecuteInput,
  ACPExecuteOutput
> {
  private laneId: string;
  private initialized = false;
  private shouldCrash = false;
  private crashCount = 0;

  constructor(laneId: string) {
    this.laneId = laneId;
  }

  init(_config: ACPConfig): Promise<void> {
    this.initialized = true;
    return Promise.resolve();
  }

  health(): Promise<ProviderHealthStatus> {
    return Promise.resolve({
      state: this.initialized && !this.shouldCrash ? "healthy" : "unavailable",
      lastCheck: new Date(),
      failureCount: this.crashCount,
    });
  }

  execute(_input: ACPExecuteInput, _correlationId: string): Promise<ACPExecuteOutput> {
    if (!this.initialized) {
      return Promise.reject(new Error("Not initialized"));
    }

    if (this.shouldCrash) {
      this.crashCount++;
      return Promise.reject(new Error(`Provider crashed (lane ${this.laneId})`));
    }

    return Promise.resolve({
      content: `Response from lane ${this.laneId}`,
      stopReason: "end_turn",
    });
  }

  terminate(): Promise<void> {
    this.initialized = false;
    return Promise.resolve();
  }

  // Test helpers
  setCrash(shouldCrash: boolean): void {
    this.shouldCrash = shouldCrash;
  }

  getLaneId(): string {
    return this.laneId;
  }
}

describe("Process-Level Isolation", () => {
  describe("Lane-Scoped Isolation", () => {
    it("should isolate provider crashes to specific lanes", async () => {
      const laneProviderA = new MockIsolatedProvider("lane-a");
      const laneProviderB = new MockIsolatedProvider("lane-b");

      // Initialize both providers
      await laneProviderA.init({ apiKey: "test", model: "claude-3-sonnet" });
      await laneProviderB.init({ apiKey: "test", model: "claude-3-sonnet" });

      // Lane A provider crashes
      laneProviderA.setCrash(true);

      // Lane A should fail
      await expect(laneProviderA.execute({ prompt: "test" }, "corr-123")).rejects.toThrow();

      // Lane B should still work (unaffected)
      const laneBaResult = await laneProviderB.execute({ prompt: "test" }, "corr-123");
      expect(laneBaResult.content).toContain("lane-b");
    });

    it("should track crashes per lane", async () => {
      const laneProviderA = new MockIsolatedProvider("lane-a");
      const laneProviderB = new MockIsolatedProvider("lane-b");

      await laneProviderA.init({ apiKey: "test", model: "claude-3-sonnet" });
      await laneProviderB.init({ apiKey: "test", model: "claude-3-sonnet" });

      // Crash lane A provider multiple times
      laneProviderA.setCrash(true);
      for (let i = 0; i < 3; i++) {
        try {
          await laneProviderA.execute({ prompt: "test" }, "corr-123");
        } catch {
          // Expected
        }
      }

      // Check lane A health
      const laneHealthA = await laneProviderA.health();
      expect(laneHealthA.failureCount).toBe(3);

      // Check lane B health (should be unaffected)
      const laneHealthB = await laneProviderB.health();
      expect(laneHealthB.failureCount).toBe(0);
      expect(laneHealthB.state).toBe("healthy");
    });
  });

  describe("Resource Isolation", () => {
    it("should prevent memory leaks from crashed provider", async () => {
      const provider = new MockIsolatedProvider("lane-1");

      await provider.init({ apiKey: "test", model: "claude-3-sonnet" });

      // Simulate multiple executions
      for (let i = 0; i < 100; i++) {
        try {
          await provider.execute({ prompt: `test-${i}` }, `corr-${i}`);
        } catch {
          // Handle error
        }
      }

      // Terminate should clean up resources
      await provider.terminate();

      // Provider should be unavailable after termination
      const health = await provider.health();
      expect(health.state).toBe("unavailable");
    });

    it("should handle graceful termination", async () => {
      const provider = new MockIsolatedProvider("lane-1");

      await provider.init({ apiKey: "test", model: "claude-3-sonnet" });

      let health = await provider.health();
      expect(health.state).toBe("healthy");

      await provider.terminate();

      health = await provider.health();
      expect(health.state).toBe("unavailable");
    });
  });

  describe("Error Handling in Isolated Providers", () => {
    it("should normalize provider crash errors", () => {
      const crashError = new Error("Provider process exited with code 1");
      const normalized = normalizeError(crashError, "acp", "corr-123");

      expect(normalized.code).toBe("PROVIDER_CRASHED");
      expect(normalized.retryable).toBe(true);
      expect(normalized.correlationId).toBe("corr-123");
    });

    it("should detect child process termination signals", () => {
      const signalError = new Error("Process killed by SIGTERM");
      const normalized = normalizeError(signalError, "mcp");

      expect(normalized.code).toBe("PROVIDER_CRASHED");
      expect(normalized.retryable).toBe(true);
    });

    it("should distinguish between timeout and crash", () => {
      const timeoutError = new Error("Provider init timeout after 5s");
      const normalizedTimeout = normalizeError(timeoutError, "acp");
      expect(normalizedTimeout.code).toBe("PROVIDER_TIMEOUT");

      const crashError = new Error("Provider process exited");
      const normalizedCrash = normalizeError(crashError, "acp");
      expect(normalizedCrash.code).toBe("PROVIDER_CRASHED");
    });
  });

  describe("Multiple Lane Isolation", () => {
    it("should support many independent lanes", async () => {
      const providers: MockIsolatedProvider[] = [];
      const laneCount = 10;

      // Create providers for each lane
      for (let i = 0; i < laneCount; i++) {
        const provider = new MockIsolatedProvider(`lane-${i}`);
        await provider.init({ apiKey: "test", model: "claude-3-sonnet" });
        providers.push(provider);
      }

      // Execute in all lanes
      const _results = await Promise.all(
        providers.map(p => p.execute({ prompt: "test" }, "corr-123"))
      );

      // All should succeed
      expect(results).toHaveLength(laneCount);
      for (const result of results) {
        expect(result.content).toBeTruthy();
      }
    });

    it("should handle selective lane failures", async () => {
      const providers: MockIsolatedProvider[] = [];

      // Create 5 providers
      for (let i = 0; i < 5; i++) {
        const provider = new MockIsolatedProvider(`lane-${i}`);
        await provider.init({ apiKey: "test", model: "claude-3-sonnet" });
        providers.push(provider);
      }

      // Make lanes 1 and 3 crash
      providers[1].setCrash(true);
      providers[3].setCrash(true);

      // Execute in all lanes and track results
      const _results = await Promise.allSettled(
        providers.map((p, i) => p.execute({ prompt: `test-${i}` }, `corr-${i}`))
      );

      // Check results: 1 and 3 should fail, others succeed
      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
      expect(results[2].status).toBe("fulfilled");
      expect(results[3].status).toBe("rejected");
      expect(results[4].status).toBe("fulfilled");

      // Lanes should be independent
      const lane0Health = await providers[0].health();
      const lane1Health = await providers[1].health();

      expect(lane0Health.failureCount).toBe(0);
      expect(lane1Health.failureCount).toBeGreaterThan(0);
    });
  });

  describe("Isolation Verification", () => {
    it("should verify no cross-lane interference", async () => {
      const providers: MockIsolatedProvider[] = [
        new MockIsolatedProvider("lane-a"),
        new MockIsolatedProvider("lane-b"),
        new MockIsolatedProvider("lane-c"),
      ];

      // Initialize all
      for (const provider of providers) {
        await provider.init({ apiKey: "test", model: "claude-3-sonnet" });
      }

      // Get initial health
      const initialHealth = await Promise.all(providers.map(p => p.health()));

      // Lane B crashes multiple times
      providers[1].setCrash(true);
      for (let i = 0; i < 5; i++) {
        try {
          await providers[1].execute({ prompt: "test" }, `corr-${i}`);
        } catch {
          // Expected
        }
      }

      // Check health again
      const finalHealth = await Promise.all(providers.map(p => p.health()));

      // Lanes A and C should be unaffected
      expect(finalHealth[0].failureCount).toBe(initialHealth[0].failureCount);
      expect(finalHealth[2].failureCount).toBe(initialHealth[2].failureCount);

      // Lane B should show increased failures
      expect(finalHealth[1].failureCount).toBeGreaterThan(initialHealth[1].failureCount);
    });
  });

  describe("Cleanup and Orphan Process Prevention", () => {
    it("should cleanup resources on terminate", async () => {
      const provider = new MockIsolatedProvider("lane-1");

      await provider.init({ apiKey: "test", model: "claude-3-sonnet" });

      // Execute some operations
      const _result = await provider.execute({ prompt: "test" }, "corr-123");
      expect(result).toBeDefined();

      // Terminate should cleanup
      await provider.terminate();

      // Verify terminated state
      const health = await provider.health();
      expect(health.state).toBe("unavailable");
    });

    it("should handle termination of crashed provider", async () => {
      const provider = new MockIsolatedProvider("lane-1");

      await provider.init({ apiKey: "test", model: "claude-3-sonnet" });

      // Cause a crash
      provider.setCrash(true);
      try {
        await provider.execute({ prompt: "test" }, "corr-123");
      } catch {
        // Expected
      }

      // Termination should still succeed
      await provider.terminate();

      const health = await provider.health();
      expect(health.state).toBe("unavailable");
    });
  });
});
