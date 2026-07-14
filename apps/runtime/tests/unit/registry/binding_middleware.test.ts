/**
 * FR-HELIOS-071: Binding Middleware Tests
 * Verifies: FR-BND-003 (Terminal binding consistency validation), FR-BND-005 (binding lifecycle events)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { BindingMiddleware } from "../../../src/registry/binding_middleware.js";
import { TerminalRegistry } from "../../../src/registry/terminal_registry.js";
import {
  BindingState,
  type BindingTriple,
  type TerminalBinding,
} from "../../../src/registry/binding_triple.js";

describe("BindingMiddleware", () => {
  let registry: TerminalRegistry;
  let middleware: BindingMiddleware;

  beforeEach(() => {
    registry = new TerminalRegistry();
    middleware = new BindingMiddleware(registry);
  });

  describe("validateBeforeOperation", () => {
    it("should validate operation on terminal with valid binding", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      registry.register("terminal-1", triple);
      const result = middleware.validateBeforeOperation("terminal-1", "write");

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.binding).toBeDefined();
      expect(result.binding?.terminalId).toBe("terminal-1");
    });

    it("should reject operation on unregistered terminal", () => {
      const result = middleware.validateBeforeOperation("terminal-nonexistent", "write");

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe("TERMINAL_NOT_FOUND");
      expect(result.error?.fatal).toBe(true);
    });

    it("should reject operation on unbound terminal", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register("terminal-1", triple);
      binding.state = BindingState.unbound;

      const result = middleware.validateBeforeOperation("terminal-1", "write");

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe("INVALID_BINDING_STATE");
      expect(result.error?.fatal).toBe(true);
    });

    it("should reject operation on validation_failed terminal", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register("terminal-1", triple);
      binding.state = BindingState.validation_failed;

      const result = middleware.validateBeforeOperation("terminal-1", "write");

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe("INVALID_BINDING_STATE");
      expect(result.error?.fatal).toBe(true);
    });

    it("should allow operation on rebound terminal", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register("terminal-1", triple);
      binding.state = BindingState.rebound;

      const result = middleware.validateBeforeOperation("terminal-1", "write");

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should update binding state to validation_failed on stale triple", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-invalid", // will fail validation
        laneId: "lane-1",
        sessionId: "session-1",
      };

      // Bypass validation to create binding with invalid triple
      const _binding = registry.register("terminal-1", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      });
      // Manually corrupt binding
      binding.binding = triple;

      const result = middleware.validateBeforeOperation("terminal-1", "write");

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe("STALE_BINDING");
      expect(result.binding?.state).toBe(BindingState.validation_failed);
    });
  });

  describe("wrapOperation", () => {
    it("should execute handler for valid binding", async () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      registry.register("terminal-1", triple);

      let called = false;
      const handler = () => {
        called = true;
        return Promise.resolve("success");
      };

      const result = await middleware.wrapOperation("terminal-1", handler, "test");

      expect(called).toBe(true);
      expect(result).toBe("success");
    });

    it("should throw error for invalid binding", async () => {
      const handler = async () => "success";

      await expect(middleware.wrapOperation("terminal-nonexistent", handler)).rejects.toThrow(
        /TERMINAL_NOT_FOUND/
      );
    });

    it("should pass binding to handler", async () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      registry.register("terminal-1", triple);

      const receivedBinding = await middleware.wrapOperation(
        "terminal-1",
        (binding: TerminalBinding) => {
          return Promise.resolve(binding);
        }
      );

      expect(receivedBinding.terminalId).toBe("terminal-1");
    });
  });

  describe("wrapOperationSync", () => {
    it("should execute sync handler for valid binding", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      registry.register("terminal-1", triple);

      let called = false;
      const handler = () => {
        called = true;
        return "success";
      };

      const result = middleware.wrapOperationSync("terminal-1", handler, "test");

      expect(called).toBe(true);
      expect(result).toBe("success");
    });

    it("should throw error for invalid binding in sync mode", () => {
      const handler = () => "success";

      expect(() => middleware.wrapOperationSync("terminal-nonexistent", handler)).toThrow(
        /TERMINAL_NOT_FOUND/
      );
    });
  });

  describe("performance", () => {
    it("should complete validations in under 5ms at p95 with 1000 sequential operations", () => {
      // Register 100 terminals
      for (let i = 0; i < 100; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: `ws-${i % 10}`,
          laneId: `lane-${i % 20}`,
          sessionId: `session-${i}`,
        });
      }

      // Run 1000 sequential validations
      const times: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const terminalId = `terminal-${i % 100}`;
        const start = performance.now();
        middleware.validateBeforeOperation(terminalId, "test");
        const time = performance.now() - start;
        times.push(time);
      }

      // Calculate p95
      times.sort((a, b) => a - b);
      const p95Index = Math.floor(times.length * 0.95);
      const p95 = times[p95Index];

      expect(p95).toBeLessThan(5);
    });
  });

  describe("state transitions", () => {
    it("should track binding state through lifecycle", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register("terminal-1", triple);
      expect(binding.state).toBe(BindingState.bound);

      registry.rebind("terminal-1", {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-2",
      });

      const rebound = registry.get("terminal-1");
      expect(rebound?.state).toBe(BindingState.rebound);
    });

    it("should validate middleware rejects stale bindings", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const _binding = registry.register("terminal-1", triple);

      // Corrupt the binding
      binding.binding = {
        workspaceId: "ws-nonexistent",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const result = middleware.validateBeforeOperation("terminal-1");

      expect(result.valid).toBe(false);
      expect(result.binding?.state).toBe(BindingState.validation_failed);
    });
  });
});
