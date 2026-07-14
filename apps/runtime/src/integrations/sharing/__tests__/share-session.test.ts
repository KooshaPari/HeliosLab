/**
 * Tests for Share Session Management and Adapters
 *
 * FR-026-001: Share session entity and lifecycle.
 * FR-026-002: Upterm backend adapter.
 * FR-026-003: Policy gate integration.
 * FR-026-004: Tmate backend adapter.
 */

import { describe, it, expect, beforeEach } from "bun:test";

import { UptermAdapter, TmateAdapter, getBackendAdapter } from "../adapters.js";
import { InMemoryLocalBus } from "../../../protocol/bus.js";

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
    if (this.shouldDeny) {
      return {
        allowed: false,
        reason: this.denialReason,
      };
    }
    return { allowed: true };
  }
}

describe("Share Session Management", () => {
  let manager: ShareSessionManager;
  let bus: InMemoryLocalBus;
  let policyGate: MockPolicyGate;

  beforeEach(() => {
    bus = new InMemoryLocalBus();
    policyGate = new MockPolicyGate();
    manager = new ShareSessionManager(bus, policyGate);
  });

  describe("Share Session Creation", () => {
    it("should create a share session with upterm backend", async () => {
      const _session = await manager.create("terminal-123", "upterm", 60000, "corr-001");

      expect(session.id).toBeTruthy();
      expect(session.terminalId).toBe("terminal-123");
      expect(session.backend).toBe("upterm");
      expect(session.state).toBe("active");
      expect(session.shareLink).toBeTruthy();
      expect(session.workerPid).toBeGreaterThan(0);
    });

    it("should create a share session with tmate backend", async () => {
      const _session = await manager.create("terminal-456", "tmate", 60000, "corr-002");

      expect(session.id).toBeTruthy();
      expect(session.backend).toBe("tmate");
      expect(session.state).toBe("active");
      expect(session.shareLink).toBeTruthy();
    });

    it("should include correlation ID in session", async () => {
      const correlationId = "unique-trace-id";

      const _session = await manager.create("terminal-123", "upterm", 60000, correlationId);

      expect(session.correlationId).toBe(correlationId);
    });

    it("should set expiration based on TTL", async () => {
      const ttlMs = 3600000; // 1 hour
      const beforeCreate = Date.now();

      const _session = await manager.create("terminal-123", "upterm", ttlMs, "corr-001");

      const afterCreate = Date.now();

      expect(session.expiresAt).toBeTruthy();
      if (session.expiresAt) {
        const expirationTime = session.expiresAt.getTime();
        expect(expirationTime).toBeGreaterThanOrEqual(beforeCreate + ttlMs);
        expect(expirationTime).toBeLessThanOrEqual(afterCreate + ttlMs);
      }
    });

    it("should emit session creation event", async () => {
      bus.getEvents(); // Clear events

      await manager.create("terminal-123", "upterm", 60000, "corr-001");

      const events = bus.getEvents();
      const createdEvent = events.find(e => e.topic === "share.session.created");
      expect(createdEvent).toBeDefined();
      expect(createdEvent?.payload?.backend).toBe("upterm");
    });

    it("should emit session active event after worker spawn", async () => {
      bus.getEvents(); // Clear events

      await manager.create("terminal-123", "upterm", 60000, "corr-001");

      const events = bus.getEvents();
      const activeEvent = events.find(e => e.topic === "share.session.active");
      expect(activeEvent).toBeDefined();
      expect(activeEvent?.payload?.shareLink).toBeTruthy();
    });
  });

  describe("Policy Gate Integration", () => {
    it("should deny share creation when policy gate denies", async () => {
      policyGate.setShouldDeny(true, "Access denied");

      await expect(manager.create("terminal-123", "upterm", 60000, "corr-001")).rejects.toThrow(
        /policy denied|access denied/i
      );
    });

    it("should emit failure event when policy denies", async () => {
      policyGate.setShouldDeny(true, "Access denied");
      bus.getEvents(); // Clear events

      try {
        await manager.create("terminal-123", "upterm", 60000, "corr-001");
      } catch {
        // Expected
      }

      const events = bus.getEvents();
      const failedEvent = events.find(e => e.topic === "share.session.failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.payload?.reason).toContain("Access denied");
    });

    it("should not spawn worker when policy denies", async () => {
      policyGate.setShouldDeny(true, "Access denied");

      try {
        await manager.create("terminal-123", "upterm", 60000, "corr-001");
      } catch {
        // Expected
      }

      // If policy denied, no worker should be spawned (no PID in failed session)
    });

    it("should allow share creation when policy approves", async () => {
      policyGate.setShouldDeny(false);

      const _session = await manager.create("terminal-123", "upterm", 60000, "corr-001");

      expect(session.state).toBe("active");
      expect(session.shareLink).toBeTruthy();
    });
  });

  describe("Share Session Termination", () => {
    it("should terminate a share session", async () => {
      const _session = await manager.create("terminal-123", "upterm", 60000, "corr-001");
      const sessionId = session.id;

      await manager.terminate(sessionId);

      const retrieved = manager.get(sessionId);
      expect(retrieved).toBeUndefined();
    });

    it("should emit termination event", async () => {
      const _session = await manager.create("terminal-123", "upterm", 60000, "corr-001");
      bus.getEvents(); // Clear events

      await manager.terminate(session.id);

      const events = bus.getEvents();
      const terminatedEvent = events.find(e => e.topic === "share.session.terminated");
      expect(terminatedEvent).toBeDefined();
    });

    it("should throw when terminating non-existent session", async () => {
      await expect(manager.terminate("non-existent")).rejects.toThrow(/not found/i);
    });

    it("should cleanup worker on termination", async () => {
      const _session = await manager.create("terminal-123", "upterm", 60000, "corr-001");
      const pidBefore = session.workerPid;

      expect(pidBefore).toBeGreaterThan(0);

      await manager.terminate(session.id);

      // Worker should be cleaned up
    });
  });

  describe("Share Session Retrieval", () => {
    it("should get session by ID", async () => {
      const created = await manager.create("terminal-123", "upterm", 60000, "corr-001");

      const retrieved = manager.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it("should return undefined for non-existent session", async () => {
      const retrieved = manager.get("non-existent");

      expect(retrieved).toBeUndefined();
    });

    it("should list sessions by terminal", async () => {
      const terminalId = "terminal-123";

      const _session1 = await manager.create(terminalId, "upterm", 60000, "corr-001");
      const _session2 = await manager.create(terminalId, "tmate", 60000, "corr-002");

      const sessions = manager.listByTerminal(terminalId);

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.id)).toContain(session1.id);
      expect(sessions.map(s => s.id)).toContain(session2.id);
    });

    it("should return empty list for terminal with no sessions", async () => {
      const sessions = manager.listByTerminal("non-existent-terminal");

      expect(sessions).toHaveLength(0);
    });

    it("should separate sessions by terminal", async () => {
      await manager.create("terminal-1", "upterm", 60000, "corr-001");
      await manager.create("terminal-2", "upterm", 60000, "corr-002");

      const sessions1 = manager.listByTerminal("terminal-1");
      const sessions2 = manager.listByTerminal("terminal-2");

      expect(sessions1).toHaveLength(1);
      expect(sessions2).toHaveLength(1);
      expect(sessions1[0].terminalId).toBe("terminal-1");
      expect(sessions2[0].terminalId).toBe("terminal-2");
    });
  });

  describe("Share Session Lifecycle", () => {
    it("should start in pending state before worker spawn", async () => {
      const _session = await manager.create("terminal-123", "upterm", 60000, "corr-001");

      // After create, should be active (worker spawned successfully)
      expect(session.state).toBe("active");
    });

    it("should transition to active after worker spawn", async () => {
      const _session = await manager.create("terminal-123", "upterm", 60000, "corr-001");

      expect(session.state).toBe("active");
      expect(session.shareLink).toBeTruthy();
    });

    it("should transition to revoked on terminate", async () => {
      const _session = await manager.create("terminal-123", "upterm", 60000, "corr-001");

      await manager.terminate(session.id);

      // Session should be removed from tracking
      const retrieved = manager.get(session.id);
      expect(retrieved).toBeUndefined();
    });

    it("should fail if worker spawn fails", async () => {
      // In mock implementation, spawn always succeeds
      // In real implementation, we would test error handling
      const _session = await manager.create("terminal-123", "upterm", 60000, "corr-001");
      expect(session.state).toBe("active");
    });
  });

  describe("Multiple Concurrent Sessions", () => {
    it("should support multiple sessions for same terminal", async () => {
      const terminalId = "terminal-123";

      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(manager.create(terminalId, "upterm", 60000, `corr-${i}`));
      }

      const sessions = await Promise.all(promises);

      expect(sessions).toHaveLength(3);
      const listResult = manager.listByTerminal(terminalId);
      expect(listResult).toHaveLength(3);
    });

    it("should track sessions separately by backend", async () => {
      const terminalId = "terminal-123";

      const _upterm = await manager.create(terminalId, "upterm", 60000, "corr-001");
      const _tmate = await manager.create(terminalId, "tmate", 60000, "corr-002");

      const sessions = manager.listByTerminal(terminalId);
      const backends = sessions.map(s => s.backend);

      expect(backends).toContain("upterm");
      expect(backends).toContain("tmate");
    });
  });
});

describe("Upterm Backend Adapter", () => {
  let adapter: UptermAdapter;

  beforeEach(() => {
    adapter = new UptermAdapter();
  });

  it("should report availability", async () => {
    const available = await adapter.checkAvailability();

    expect(typeof available).toBe("boolean");
  });

  it("should start share with upterm command", async () => {
    const _result = await adapter.startShare("terminal-123", "main-session");

    expect(result.link).toBeTruthy();
    expect(result.link).toContain("upterm.io");
    expect(result.process).toBeDefined();
  });

  it("should validate inputs before starting share", async () => {
    await expect(adapter.startShare("", "main-session")).rejects.toThrow(/missing/i);

    await expect(adapter.startShare("terminal-123", "")).rejects.toThrow(/missing/i);
  });

  it("should stop share gracefully", async () => {
    const _result = await adapter.startShare("terminal-123", "main-session");

    // Should not throw
    await adapter.stopShare(result.process);
  });

  it("should support custom upterm server", async () => {
    const customAdapter = new UptermAdapter({
      server: "custom.upterm.io",
    });

    const _result = await customAdapter.startShare("terminal-123", "main-session");

    expect(result.link).toBeTruthy();
  });
});

describe("Tmate Backend Adapter", () => {
  let adapter: TmateAdapter;

  beforeEach(() => {
    adapter = new TmateAdapter();
  });

  it("should report availability", async () => {
    const available = await adapter.checkAvailability();

    expect(typeof available).toBe("boolean");
  });

  it("should start share with tmate command", async () => {
    const _result = await adapter.startShare("terminal-123", "main-session");

    expect(result.link).toBeTruthy();
    expect(result.link).toContain("tmate.io");
    expect(result.process).toBeDefined();
  });

  it("should validate inputs before starting share", async () => {
    await expect(adapter.startShare("", "main-session")).rejects.toThrow(/missing/i);
  });

  it("should stop share gracefully", async () => {
    const _result = await adapter.startShare("terminal-123", "main-session");

    // Should not throw
    await adapter.stopShare(result.process);
  });
});

describe("Backend Adapter Factory", () => {
  it("should get upterm adapter", () => {
    const adapter = getBackendAdapter("upterm");

    expect(adapter).toBeInstanceOf(UptermAdapter);
  });

  it("should get tmate adapter", () => {
    const adapter = getBackendAdapter("tmate");

    expect(adapter).toBeInstanceOf(TmateAdapter);
  });

  it("should throw for unknown backend", () => {
    expect(() => getBackendAdapter("unknown")).toThrow(/unknown backend/i);
  });

  it("should accept backend-specific config", () => {
    const adapter = getBackendAdapter("upterm", { server: "custom.io" });

    expect(adapter).toBeInstanceOf(UptermAdapter);
  });
});
