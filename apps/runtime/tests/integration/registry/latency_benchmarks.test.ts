/**
 * FR-HELIOS-111: Registry Latency Benchmarks
 * Verifies: FR-PRF-004 (Registry operation latency SLO)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { TerminalRegistry } from "../../../src/registry/terminal_registry.js";
import { BindingMiddleware } from "../../../src/registry/binding_middleware.js";


describe("Latency Benchmarks", () => {
  let registry: TerminalRegistry;
  let middleware: BindingMiddleware;

  beforeEach(() => {
    registry = new TerminalRegistry();
    middleware = new BindingMiddleware(registry);
  });

  function percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * p);
    return sorted[index];
  }

  describe("lookup operations with 500+ bindings", () => {
    beforeEach(() => {
      // Register 500 terminals
      for (let i = 0; i < 500; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: `ws-${i % 20}`,
          laneId: `lane-${i % 50}`,
          sessionId: `session-${i}`,
        });
      }
    });

    it("should lookup by terminal_id in <2ms at p95", () => {
      const times: number[] = [];

      // Run 1000 lookups
      for (let i = 0; i < 1000; i++) {
        const terminalId = `terminal-${i % 500}`;
        const start = performance.now();
        registry.get(terminalId);
        const time = performance.now() - start;
        times.push(time);
      }

      const p95 = percentile(times, 0.95);
      expect(p95).toBeLessThan(2);
    });

    it("should lookup by lane_id in <2ms at p95", () => {
      const times: number[] = [];

      // Run 1000 lookups
      for (let i = 0; i < 1000; i++) {
        const laneId = `lane-${i % 50}`;
        const start = performance.now();
        registry.getByLane(laneId);
        const time = performance.now() - start;
        times.push(time);
      }

      const p95 = percentile(times, 0.95);
      expect(p95).toBeLessThan(2);
    });

    it("should lookup by session_id in <2ms at p95", () => {
      const times: number[] = [];

      // Run 1000 lookups
      for (let i = 0; i < 1000; i++) {
        const sessionId = `session-${i % 500}`;
        const start = performance.now();
        registry.getBySession(sessionId);
        const time = performance.now() - start;
        times.push(time);
      }

      const p95 = percentile(times, 0.95);
      expect(p95).toBeLessThan(2);
    });

    it("should lookup by workspace_id in <2ms at p95", () => {
      const times: number[] = [];

      // Run 1000 lookups
      for (let i = 0; i < 1000; i++) {
        const workspaceId = `ws-${i % 20}`;
        const start = performance.now();
        registry.getByWorkspace(workspaceId);
        const time = performance.now() - start;
        times.push(time);
      }

      const p95 = percentile(times, 0.95);
      expect(p95).toBeLessThan(2);
    });

    it("should support getAll() efficiently", () => {
      const start = performance.now();
      const all = registry.getAll();
      const time = performance.now() - start;

      expect(all).toHaveLength(500);
      expect(time).toBeLessThan(2);
    });
  });

  describe("validation middleware latency", () => {
    beforeEach(() => {
      // Register 500 terminals with valid bindings
      for (let i = 0; i < 500; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: `ws-${i % 20}`,
          laneId: `lane-${i % 50}`,
          sessionId: `session-${i}`,
        });
      }
    });

    it("should validate before operation in <5ms at p95", () => {
      const times: number[] = [];

      // Run 1000 validations
      for (let i = 0; i < 1000; i++) {
        const terminalId = `terminal-${i % 500}`;
        const start = performance.now();
        middleware.validateBeforeOperation(terminalId, "test");
        const time = performance.now() - start;
        times.push(time);
      }

      const p95 = percentile(times, 0.95);
      expect(p95).toBeLessThan(5);
    });

    it("should handle mixed valid and invalid terminals", () => {
      const times: number[] = [];

      // Run 1000 validations with 10% invalid
      for (let i = 0; i < 1000; i++) {
        const isInvalid = Math.random() < 0.1;
        const terminalId = isInvalid ? `terminal-invalid-${i}` : `terminal-${i % 500}`;

        const start = performance.now();
        middleware.validateBeforeOperation(terminalId);
        const time = performance.now() - start;
        times.push(time);
      }

      const p95 = percentile(times, 0.95);
      expect(p95).toBeLessThan(5);
    });
  });

  describe("CRUD operations performance", () => {
    it("should register 1000 bindings efficiently", () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: `ws-${i % 20}`,
          laneId: `lane-${i % 100}`,
          sessionId: `session-${i}`,
        });
      }

      const time = performance.now() - start;
      // 1000 registrations should complete in reasonable time (no strict SLO)
      expect(time).toBeLessThan(1000); // 1 second budget
    });

    it("should rebind terminals efficiently with index updates", () => {
      // Register 100 terminals first
      for (let i = 0; i < 100; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: "ws-1",
          laneId: "lane-1",
          sessionId: `session-${i}`,
        });
      }

      const times: number[] = [];

      // Rebind 100 times, measuring each
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        registry.rebind(`terminal-${i}`, {
          workspaceId: "ws-1",
          laneId: `lane-${i % 10}`,
          sessionId: `session-rebound-${i}`,
        });
        const time = performance.now() - start;
        times.push(time);
      }

      const p95 = percentile(times, 0.95);
      expect(p95).toBeLessThan(2);
    });

    it("should unregister terminals efficiently", () => {
      // Register 100 terminals first
      for (let i = 0; i < 100; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: "ws-1",
          laneId: `lane-${i % 10}`,
          sessionId: `session-${i}`,
        });
      }

      const times: number[] = [];

      // Unregister 100 times, measuring each
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        registry.unregister(`terminal-${i}`);
        const time = performance.now() - start;
        times.push(time);
      }

      const p95 = percentile(times, 0.95);
      expect(p95).toBeLessThan(2);
    });
  });

  describe("sustained load", () => {
    it("should maintain performance under sustained operations", () => {
      // Simulate sustained load: register, rebind, query cycle
      const operations = [];

      for (let cycle = 0; cycle < 10; cycle++) {
        // Register 50 terminals
        for (let i = 0; i < 50; i++) {
          const terminalId = `terminal-cycle-${cycle}-${i}`;
          const start = performance.now();
          registry.register(terminalId, {
            workspaceId: `ws-${cycle % 5}`,
            laneId: `lane-${i % 10}`,
            sessionId: `session-${cycle}-${i}`,
          });
          operations.push(performance.now() - start);
        }

        // Rebind 25 of them
        for (let i = 0; i < 25; i++) {
          const terminalId = `terminal-cycle-${cycle}-${i}`;
          const start = performance.now();
          registry.rebind(terminalId, {
            workspaceId: `ws-${cycle % 5}`,
            laneId: `lane-${(i + 1) % 10}`,
            sessionId: `session-rebound-${cycle}-${i}`,
          });
          operations.push(performance.now() - start);
        }

        // Query all keys
        const start = performance.now();
        registry.getAll();
        operations.push(performance.now() - start);
      }

      const p95 = percentile(operations, 0.95);
      expect(p95).toBeLessThan(5);
    });
  });

  describe("memory efficiency", () => {
    it("should not degrade with large datasets", () => {
      // Register progressively larger datasets and check lookup time
      const results: Array<{ count: number; p95: number }> = [];

      for (const count of [100, 250, 500]) {
        registry.clear();

        for (let i = 0; i < count; i++) {
          registry.register(`terminal-${i}`, {
            workspaceId: `ws-${i % 20}`,
            laneId: `lane-${i % 50}`,
            sessionId: `session-${i}`,
          });
        }

        const times: number[] = [];
        for (let i = 0; i < 100; i++) {
          const terminalId = `terminal-${i % count}`;
          const start = performance.now();
          registry.get(terminalId);
          times.push(performance.now() - start);
        }

        const p95 = percentile(times, 0.95);
        results.push({ count, p95 });
      }

      // Verify p95 doesn't degrade significantly as dataset grows
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1];
        const curr = results[i];
        // p95 should not increase more than 2x when doubling dataset
        expect(curr.p95).toBeLessThan(prev.p95 * 2.5);
      }
    });
  });
});
