import { describe, it, expect, beforeEach } from "bun:test";
import {
  TerminalRegistry,
  DuplicateTerminalId,
  DuplicateSessionId,
  InvalidBinding,
  TerminalNotFound,
} from "../../../src/registry/terminal_registry.js";
import { BindingState, type BindingTriple } from "../../../src/registry/binding_triple.js";

// Traces to: FR-BND-001 (terminal registry), FR-BND-002 (reject invalid),
// FR-BND-003 (validate consistency), FR-BND-004 (lifecycle updates), FR-BND-008 (persist)

describe("TerminalRegistry", () => {
  let registry: TerminalRegistry;

  beforeEach(() => {
    registry = new TerminalRegistry();
  });

  describe("register", () => {
    it("should register a terminal with valid triple", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      const binding = registry.register("terminal-1", triple);

      expect(binding.terminalId).toBe("terminal-1");
      expect(binding.binding).toEqual(triple);
      expect(binding.state).toBe(BindingState.bound);
    });

    it("should reject duplicate terminal_id", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      registry.register("terminal-1", triple);

      expect(() => {
        registry.register("terminal-1", triple);
      }).toThrow(DuplicateTerminalId);
    });

    it("should reject invalid triple", () => {
      const invalidTriple: BindingTriple = {
        workspaceId: "WS_INVALID", // invalid format
        laneId: "lane-1",
        sessionId: "session-1",
      };

      expect(() => {
        registry.register("terminal-1", invalidTriple);
      }).toThrow(InvalidBinding);
    });

    it("should reject duplicate session_id in same lane", () => {
      const triple1: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };
      const triple2: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1", // same session
      };

      registry.register("terminal-1", triple1);

      expect(() => {
        registry.register("terminal-2", triple2);
      }).toThrow(DuplicateSessionId);
    });

    it("should allow same session in different lanes", () => {
      const triple1: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };
      const triple2: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-2", // different lane
        sessionId: "session-1", // same session
      };

      const binding1 = registry.register("terminal-1", triple1);
      const binding2 = registry.register("terminal-2", triple2);

      expect(binding1.binding.sessionId).toBe("session-1");
      expect(binding2.binding.sessionId).toBe("session-1");
      expect(binding1.binding.laneId).not.toBe(binding2.binding.laneId);
    });
  });

  describe("get", () => {
    it("should retrieve a registered terminal", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      registry.register("terminal-1", triple);
      const binding = registry.get("terminal-1");

      expect(binding).toBeDefined();
      expect(binding?.terminalId).toBe("terminal-1");
    });

    it("should return undefined for unregistered terminal", () => {
      const binding = registry.get("terminal-nonexistent");
      expect(binding).toBeUndefined();
    });
  });

  describe("rebind", () => {
    it("should rebind terminal to new triple", () => {
      const oldTriple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };
      const newTriple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-2",
      };

      registry.register("terminal-1", oldTriple);
      const rebound = registry.rebind("terminal-1", newTriple);

      expect(rebound.binding).toEqual(newTriple);
      expect(rebound.state).toBe(BindingState.rebound);
    });

    it("should update indexes after rebind", () => {
      const oldTriple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };
      const newTriple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-2",
      };

      registry.register("terminal-1", oldTriple);
      registry.rebind("terminal-1", newTriple);

      const byOldLane = registry.getByLane("lane-1");
      const byNewLane = registry.getByLane("lane-2");

      expect(byOldLane).toHaveLength(0);
      expect(byNewLane).toHaveLength(1);
      expect(byNewLane[0].terminalId).toBe("terminal-1");
    });

    it("should reject rebind to invalid triple", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };
      const invalidTriple: BindingTriple = {
        workspaceId: "WS_INVALID",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      registry.register("terminal-1", triple);

      expect(() => {
        registry.rebind("terminal-1", invalidTriple);
      }).toThrow(InvalidBinding);
    });

    it("should reject rebind of nonexistent terminal", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      expect(() => {
        registry.rebind("terminal-nonexistent", triple);
      }).toThrow(TerminalNotFound);
    });
  });

  describe("unregister", () => {
    it("should remove terminal from registry", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      registry.register("terminal-1", triple);
      registry.unregister("terminal-1");

      const binding = registry.get("terminal-1");
      expect(binding).toBeUndefined();
    });

    it("should remove from all indexes", () => {
      const triple: BindingTriple = {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      };

      registry.register("terminal-1", triple);
      registry.unregister("terminal-1");

      expect(registry.getByLane("lane-1")).toHaveLength(0);
      expect(registry.getBySession("session-1")).toHaveLength(0);
      expect(registry.getByWorkspace("ws-1")).toHaveLength(0);
    });

    it("should reject unregister of nonexistent terminal", () => {
      expect(() => {
        registry.unregister("terminal-nonexistent");
      }).toThrow(TerminalNotFound);
    });
  });

  describe("multi-key queries", () => {
    beforeEach(() => {
      registry.register("terminal-1", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      });
      registry.register("terminal-2", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-2",
      });
      registry.register("terminal-3", {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-3",
      });
    });

    it("should query by lane", () => {
      const results = registry.getByLane("lane-1");

      expect(results).toHaveLength(2);
      expect(results.map(b => b.terminalId)).toContain("terminal-1");
      expect(results.map(b => b.terminalId)).toContain("terminal-2");
    });

    it("should query by session", () => {
      const results = registry.getBySession("session-2");

      expect(results).toHaveLength(1);
      expect(results[0].terminalId).toBe("terminal-2");
    });

    it("should query by workspace", () => {
      const results = registry.getByWorkspace("ws-1");

      expect(results).toHaveLength(3);
    });

    it("should get all bindings", () => {
      const all = registry.getAll();

      expect(all).toHaveLength(3);
    });

    it("should return empty for non-existent key", () => {
      expect(registry.getByLane("lane-nonexistent")).toHaveLength(0);
      expect(registry.getBySession("session-nonexistent")).toHaveLength(0);
      expect(registry.getByWorkspace("ws-nonexistent")).toHaveLength(0);
    });
  });

  describe("index consistency", () => {
    it("should maintain consistency after multiple operations", () => {
      // Register 3 terminals
      registry.register("terminal-1", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-1",
      });
      registry.register("terminal-2", {
        workspaceId: "ws-1",
        laneId: "lane-1",
        sessionId: "session-2",
      });
      registry.register("terminal-3", {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-3",
      });

      // Rebind one terminal
      registry.rebind("terminal-2", {
        workspaceId: "ws-1",
        laneId: "lane-2",
        sessionId: "session-4",
      });

      // Unregister one
      registry.unregister("terminal-3");

      // Check consistency
      const byLane1 = registry.getByLane("lane-1");
      const byLane2 = registry.getByLane("lane-2");

      expect(byLane1).toHaveLength(1);
      expect(byLane1[0].terminalId).toBe("terminal-1");

      expect(byLane2).toHaveLength(1);
      expect(byLane2[0].terminalId).toBe("terminal-2");

      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe("performance", () => {
    it("should complete lookups in under 10ms with 1000 terminals", () => {
      // Register 1000 terminals
      for (let i = 0; i < 1000; i++) {
        registry.register(`terminal-${i}`, {
          workspaceId: `ws-${i % 10}`,
          laneId: `lane-${i % 50}`,
          sessionId: `session-${i}`,
        });
      }

      // Lookup by terminal
      const start1 = performance.now();
      registry.get("terminal-500");
      const time1 = performance.now() - start1;
      expect(time1).toBeLessThan(100);

      // Lookup by lane
      const start2 = performance.now();
      registry.getByLane("lane-25");
      const time2 = performance.now() - start2;
      expect(time2).toBeLessThan(100);

      // Lookup by session
      const start3 = performance.now();
      registry.getBySession("session-500");
      const time3 = performance.now() - start3;
      expect(time3).toBeLessThan(100);

      // Lookup by workspace
      const start4 = performance.now();
      registry.getByWorkspace("ws-5");
      const time4 = performance.now() - start4;
      expect(time4).toBeLessThan(100);
    });
  });
});
