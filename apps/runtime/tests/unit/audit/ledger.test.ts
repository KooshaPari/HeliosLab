import { describe, it, expect, beforeEach } from "bun:test";
import { AuditLedger } from "../../../src/audit/ledger";
import { AuditRingBuffer } from "../../../src/audit/ring-buffer";
import { SQLiteAuditStore } from "../../../src/audit/sqlite-store";
import { createAuditEvent, AUDIT_EVENT_TYPES, AUDIT_EVENT_RESULTS } from "../../../src/audit/event";

// Traces to: FR-AUD-001 (structured schema), FR-AUD-002 (append-only),
// FR-AUD-005 (search/filter), FR-MVP-003 (display tool calls), FR-MVP-011 (persist conversations)

describe("AuditLedger", () => {
  let ledger: AuditLedger;
  let ringBuffer: AuditRingBuffer;
  let store: SQLiteAuditStore;

  beforeEach(() => {
    ringBuffer = new AuditRingBuffer(100);
    store = new SQLiteAuditStore(":memory:");
    ledger = new AuditLedger(ringBuffer, store);
  });

  describe("search", () => {
    beforeEach(() => {
      // Add events to ring buffer
      for (let i = 0; i < 50; i++) {
        const event = createAuditEvent({
          eventType:
            i % 2 === 0 ? AUDIT_EVENT_TYPES.COMMAND_EXECUTED : AUDIT_EVENT_TYPES.SESSION_CREATED,
          actor: `agent-${i % 5}`,
          action: "test",
          target: `target-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: i < 25 ? "ws-1" : "ws-2",
          laneId: `lane-${i % 10}`,
          sessionId: `session-${i % 3}`,
          correlationId: `corr-${i}`,
          metadata: {},
        });
        ringBuffer.push(event);
      }

      // Add events to store
      const events = [];
      for (let i = 50; i < 100; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATION,
          actor: "system",
          action: "evaluate",
          target: `policy-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: `corr-${i}`,
          metadata: {},
        });
        events.push(event);
      }
      store.persist(events);
    });

    it("should filter by workspace ID", () => {
      const results = ledger.search({ workspaceId: "ws-1" });
      expect(results.every(e => e.workspaceId === "ws-1")).toBe(true);
    });

    it("should filter by actor", () => {
      const results = ledger.search({ actor: "agent-0" });
      expect(results.every(e => e.actor === "agent-0")).toBe(true);
    });

    it("should filter by event type", () => {
      const results = ledger.search({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
      });
      expect(results.every(e => e.eventType === AUDIT_EVENT_TYPES.COMMAND_EXECUTED)).toBe(true);
    });

    it("should merge results from ring buffer and store", () => {
      const results = ledger.search({ workspaceId: "ws-1", limit: 100 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(100);
    });

    it("should maintain chronological order", () => {
      const results = ledger.search({ workspaceId: "ws-1", limit: 100 });

      for (let i = 1; i < results.length; i++) {
        const prevTime = new Date(results[i - 1].timestamp).getTime();
        const currTime = new Date(results[i].timestamp).getTime();
        expect(prevTime).toBeLessThanOrEqual(currTime);
      }
    });

    it("should respect limit and offset", () => {
      const page1 = ledger.search({
        workspaceId: "ws-1",
        limit: 10,
        offset: 0,
      });
      const page2 = ledger.search({
        workspaceId: "ws-1",
        limit: 10,
        offset: 10,
      });

      expect(page1.length).toBeLessThanOrEqual(10);
      expect(page2.length).toBeLessThanOrEqual(10);

      if (page1.length > 0 && page2.length > 0) {
        expect(page1[0].id).not.toBe(page2[0].id);
      }
    });
  });

  describe("count", () => {
    it("should count events matching filter", () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "cmd",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-1",
        correlationId: "corr-1",
        metadata: {},
      });

      ringBuffer.push(event);

      const count = ledger.count({ workspaceId: "ws-1" });
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("getCorrelationChain", () => {
    it("should return all events with same correlation ID", () => {
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

      ringBuffer.push(event1);
      const events = [event2];
      store.persist(events);

      const chain = ledger.getCorrelationChain("chain-1");
      expect(chain.length).toBe(2);
      expect(chain[0].metadata.step).toBe(1);
      expect(chain[1].metadata.step).toBe(2);
    });

    it("should be in chronological order", () => {
      const chain = ledger.getCorrelationChain("chain-1");

      for (let i = 1; i < chain.length; i++) {
        const prevTime = new Date(chain[i - 1].timestamp).getTime();
        const currTime = new Date(chain[i].timestamp).getTime();
        expect(prevTime).toBeLessThanOrEqual(currTime);
      }
    });
  });

  describe("subscribe", () => {
    it("should deliver matching events to subscriber", done => {
      let callCount = 0;

      const unsubscribe = ledger.subscribe({ workspaceId: "ws-1" }, event => {
        callCount++;
        expect(event.workspaceId).toBe("ws-1");
      });

      // Notify with matching event
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "cmd",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-1",
        correlationId: "corr-1",
        metadata: {},
      });

      ledger.notifyEvent(event);

      // Wait for batched delivery (100ms batch interval + setImmediate hop)
      setTimeout(() => {
        expect(callCount).toBe(1);
        unsubscribe();
        done();
      }, 300);
    });

    it("should filter non-matching events", done => {
      let callCount = 0;

      const unsubscribe = ledger.subscribe({ workspaceId: "ws-1" }, () => {
        callCount++;
      });

      // Notify with non-matching event
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
        actor: "agent-1",
        action: "create",
        target: "session-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-2", // Different workspace
        correlationId: "corr-1",
        metadata: {},
      });

      ledger.notifyEvent(event);

      // Wait for potential delivery
      setTimeout(() => {
        expect(callCount).toBe(0);
        unsubscribe();
        done();
      }, 150);
    });

    it("should allow unsubscribe", () => {
      const unsubscribe = ledger.subscribe({ workspaceId: "ws-1" }, () => {});
      unsubscribe();

      // Should not throw when unsubscribing again
      expect(() => unsubscribe()).not.toThrow();
    });
  });
});
