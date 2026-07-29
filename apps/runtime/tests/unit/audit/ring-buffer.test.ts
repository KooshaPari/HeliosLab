import { describe, it, expect, beforeEach } from "bun:test";
import { AuditRingBuffer } from "../../../src/audit/ring-buffer";
import { createAuditEvent, AUDIT_EVENT_TYPES, AUDIT_EVENT_RESULTS } from "../../../src/audit/event";

// Traces to: FR-AUD-003 (in-memory ring buffer for hot queries)

describe("AuditRingBuffer", () => {
  let buffer: AuditRingBuffer;

  beforeEach(() => {
    buffer = new AuditRingBuffer(10);
  });

  describe("push", () => {
    it("should append events to buffer", () => {
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

      const evicted = buffer.push(event);
      expect(evicted).toBeUndefined();
      expect(buffer.getSize()).toBe(1);
    });

    it("should evict oldest event when full", () => {
      const events = [];

      // Fill buffer to capacity
      for (let i = 0; i < 10; i++) {
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
        const evicted = buffer.push(event);
        expect(evicted).toBeUndefined();
      }

      // Push one more; should evict the first
      const event11 = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
        actor: "agent-1",
        action: "create",
        target: "session-10",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-1",
        correlationId: "corr-10",
        metadata: { index: 10 },
      });

      const evicted = buffer.push(event11);
      expect(evicted).toBeDefined();
      expect(evicted?.metadata.index).toBe(0);
      expect(buffer.getSize()).toBe(10); // Still at capacity
    });
  });

  describe("getRecent", () => {
    it("should return N most recent events", () => {
      for (let i = 0; i < 5; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATION,
          actor: "system",
          action: "evaluate",
          target: `policy-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: `corr-${i}`,
          metadata: { index: i },
        });
        buffer.push(event);
      }

      const recent = buffer.getRecent(3);
      expect(recent.length).toBe(3);
      expect(recent[0].metadata.index).toBe(2);
      expect(recent[1].metadata.index).toBe(3);
      expect(recent[2].metadata.index).toBe(4);
    });

    it("should return all events if count exceeds size", () => {
      for (let i = 0; i < 3; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.TERMINAL_OUTPUT,
          actor: "agent-1",
          action: "output",
          target: "terminal-1",
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: `corr-${i}`,
          metadata: { index: i },
        });
        buffer.push(event);
      }

      const recent = buffer.getRecent(100);
      expect(recent.length).toBe(3);
    });
  });

  describe("query", () => {
    it("should filter by workspace ID", () => {
      for (let i = 0; i < 5; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
          actor: "agent-1",
          action: "execute",
          target: `cmd-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: i % 2 === 0 ? "ws-1" : "ws-2",
          correlationId: `corr-${i}`,
          metadata: {},
        });
        buffer.push(event);
      }

      const results = buffer.query({ workspaceId: "ws-1" });
      expect(results.length).toBe(3);
      expect(results.every(e => e.workspaceId === "ws-1")).toBe(true);
    });

    it("should filter by actor", () => {
      for (let i = 0; i < 5; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
          actor: i % 2 === 0 ? "agent-1" : "agent-2",
          action: "create",
          target: `session-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: `corr-${i}`,
          metadata: {},
        });
        buffer.push(event);
      }

      const results = buffer.query({ actor: "agent-1" });
      expect(results.length).toBe(3);
      expect(results.every(e => e.actor === "agent-1")).toBe(true);
    });

    it("should filter by event type", () => {
      const eventTypes = [
        AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        AUDIT_EVENT_TYPES.SESSION_CREATED,
        AUDIT_EVENT_TYPES.POLICY_EVALUATION,
      ];

      for (let i = 0; i < 6; i++) {
        const event = createAuditEvent({
          eventType: eventTypes[i % 3],
          actor: "agent-1",
          action: "test",
          target: `target-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: `corr-${i}`,
          metadata: {},
        });
        buffer.push(event);
      }

      const results = buffer.query({
        eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
      });
      expect(results.length).toBe(2);
    });
  });

  describe("getByCorrelationId", () => {
    it("should return events with matching correlation ID", () => {
      for (let i = 0; i < 5; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.APPROVAL_RESOLVED,
          actor: "operator-1",
          action: "resolve",
          target: `approval-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: i < 3 ? "corr-chain-1" : "corr-other",
          metadata: {},
        });
        buffer.push(event);
      }

      const results = buffer.getByCorrelationId("corr-chain-1");
      expect(results.length).toBe(3);
      expect(results.every(e => e.correlationId === "corr-chain-1")).toBe(true);
    });
  });

  describe("getMetrics", () => {
    it("should track metrics correctly", () => {
      let evictedCount = 0;

      for (let i = 0; i < 15; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
          actor: "agent-1",
          action: "execute",
          target: `cmd-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId: `corr-${i}`,
          metadata: {},
        });

        const evicted = buffer.push(event);
        if (evicted) {
          evictedCount++;
        }
      }

      const metrics = buffer.getMetrics();
      expect(metrics.capacity).toBe(10);
      expect(metrics.currentSize).toBe(10);
      expect(metrics.totalEventsProcessed).toBe(15);
      expect(metrics.totalEventsEvicted).toBe(evictedCount);
    });
  });
});
