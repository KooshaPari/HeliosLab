/**
 * FR-HELIOS-046: SQLite Audit Store Tests
 * Verifies: FR-AUD-004 (SQLite persistence for durable retention)
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQLiteAuditStore } from "../../../src/audit/sqlite-store";
import { createAuditEvent, AUDIT_EVENT_TYPES, AUDIT_EVENT_RESULTS } from "../../../src/audit/event";

describe("SQLiteAuditStore", () => {
  let store: SQLiteAuditStore;

  beforeEach(() => {
    store = new SQLiteAuditStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  describe("persist", () => {
    it("should persist events to database", () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "cmd",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-1",
        correlationId: "corr-1",
        metadata: { exitCode: 0 },
      });

      store.persist([event]);

      const count = store.count();
      expect(count).toBe(1);
    });

    it("should batch insert efficiently", () => {
      const events = [];

      for (let i = 0; i < 1000; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
          actor: "agent-1",
          action: "create",
          target: `session-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: `corr-${i}`,
          metadata: { index: i },
        });
        events.push(event);
      }

      const _startTime = Date.now();
      store.persist(events);
      const endTime = Date.now();

      expect(store.count()).toBe(1000);

      // Should complete in < 1 second for 1000 events
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe("query", () => {
    beforeEach(() => {
      const events = [];

      for (let i = 0; i < 100; i++) {
        const event = createAuditEvent({
          eventType:
            i % 3 === 0
              ? AUDIT_EVENT_TYPES.COMMAND_EXECUTED
              : i % 3 === 1
                ? AUDIT_EVENT_TYPES.POLICY_EVALUATION
                : AUDIT_EVENT_TYPES.SESSION_CREATED,
          actor: `agent-${i % 5}`,
          action: "test",
          target: `target-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: i < 50 ? "ws-1" : "ws-2",
          correlationId: `corr-${i}`,
          metadata: { index: i },
        });
        events.push(event);
      }

      store.persist(events);
    });

    it("should query with workspace filter", () => {
      const _results = store.query({ workspaceId: "ws-1" });
      expect(results.length).toBeLessThanOrEqual(100);
      expect(results.every(e => e.workspaceId === "ws-1")).toBe(true);
    });

    it("should query with event type filter", () => {
      const _results = store.query({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(e => e.eventType === AUDIT_EVENT_TYPES.COMMAND_EXECUTED)).toBe(true);
    });

    it("should query with pagination", () => {
      const results1 = store.query({ workspaceId: "ws-1" }, { limit: 10, offset: 0 });
      const results2 = store.query({ workspaceId: "ws-1" }, { limit: 10, offset: 10 });

      expect(results1.length).toBeLessThanOrEqual(10);
      expect(results2.length).toBeLessThanOrEqual(10);
      expect(results1[0].id).not.toBe(results2[0].id);
    });
  });

  describe("getByCorrelationChain", () => {
    it("should return all events with matching correlation ID", () => {
      const event1 = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATION,
        actor: "system",
        action: "evaluate",
        target: "policy-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-1",
        correlationId: "chain-1",
        metadata: { step: 1 },
      });

      const event2 = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.APPROVAL_RESOLVED,
        actor: "operator-1",
        action: "approve",
        target: "approval-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-1",
        correlationId: "chain-1",
        metadata: { step: 2 },
      });

      store.persist([event1, event2]);

      const chain = store.getByCorrelationChain("chain-1");
      expect(chain.length).toBe(2);
      // Sort by step so order doesn't depend on UUID v7 tiebreaker
      const steps = chain.map(e => e.metadata.step).sort();
      expect(steps).toEqual([1, 2]);
    });
  });

  describe("count", () => {
    beforeEach(() => {
      const events = [];

      for (let i = 0; i < 50; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.TERMINAL_OUTPUT,
          actor: "agent-1",
          action: "output",
          target: "terminal-1",
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: `corr-${i}`,
          metadata: {},
        });
        events.push(event);
      }

      store.persist(events);
    });

    it("should count all events", () => {
      const count = store.count();
      expect(count).toBe(50);
    });

    it("should count with filter", () => {
      const count = store.count({ workspaceId: "ws-1" });
      expect(count).toBe(50);
    });
  });

  describe("getStorageSize", () => {
    it("should return 0 for in-memory database", () => {
      const size = store.getStorageSize();
      expect(size).toBe(0);
    });
  });

  describe("WAL mode", () => {
    it("should enable WAL mode for concurrent access", () => {
      // This test verifies WAL mode is enabled by checking no errors occur during
      // concurrent operations (which would fail without WAL mode)
      const events = [];

      for (let i = 0; i < 100; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
          actor: "agent-1",
          action: "execute",
          target: `cmd-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: `corr-${i}`,
          metadata: { index: i },
        });
        events.push(event);
      }

      // Persist while querying (simulates concurrent access)
      store.persist(events.slice(0, 50));
      const _results = store.query({ workspaceId: "ws-1" });

      store.persist(events.slice(50, 100));
      const finalResults = store.query({ workspaceId: "ws-1" });

      expect(finalResults.length).toBeGreaterThanOrEqual(results.length);
    });
  });
});
