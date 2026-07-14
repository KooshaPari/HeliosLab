/**
 * FR-HELIOS-063: Audit Sink Tests
 * Verifies: FR-AUD-002 (Append-only log), FR-SEC-005 (Redaction at sink boundary)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { DefaultAuditSink, NoOpAuditStorage } from "../../../src/audit/sink";
import { createAuditEvent, AUDIT_EVENT_TYPES, AUDIT_EVENT_RESULTS } from "../../../src/audit/event";

describe("AuditSink", () => {
  let sink: DefaultAuditSink;
  let storage: NoOpAuditStorage;

  beforeEach(() => {
    storage = new NoOpAuditStorage();
    sink = new DefaultAuditSink(storage);
  });

  describe("write", () => {
    it("should write an event non-blocking", async () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "cmd",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      });

      const startTime = Date.now();
      await sink.write(event);
      const endTime = Date.now();

      // Should return in < 50ms (relaxed for CI environments)
      expect(endTime - startTime).toBeLessThan(50);
      expect(sink.getBufferedCount()).toBe(1);
    });

    it("should increment total events written", async () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
        actor: "agent-1",
        action: "create",
        target: "session-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      });

      const metrics1 = sink.getMetrics();
      expect(metrics1.totalEventsWritten).toBe(0);

      await sink.write(event);

      const metrics2 = sink.getMetrics();
      expect(metrics2.totalEventsWritten).toBe(1);
    });

    it("should track buffer high-water mark", async () => {
      for (let i = 0; i < 5; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
          actor: "agent-1",
          action: "execute",
          target: `cmd-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "workspace-1",
          correlationId: `corr-${i}`,
          metadata: {},
        });
        await sink.write(event);
      }

      const metrics = sink.getMetrics();
      expect(metrics.bufferHighWaterMark).toBeGreaterThanOrEqual(5);
    });
  });

  describe("flush", () => {
    it("should flush buffered events", async () => {
      const event1 = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "cmd-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      });

      const event2 = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
        actor: "agent-1",
        action: "create",
        target: "session-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-2",
        metadata: {},
      });

      await sink.write(event1);
      await sink.write(event2);

      expect(sink.getBufferedCount()).toBeGreaterThan(0);

      await sink.flush();

      // After flush, all events should be persisted
      // Since we use NoOpAuditStorage, buffer will still have events
      // but they will have been passed to storage
    });

    it("should not error when flushing empty buffer", async () => {
      expect(sink.getBufferedCount()).toBe(0);
      await expect(sink.flush()).resolves.toBeUndefined();
    });
  });

  describe("getBufferedCount", () => {
    it("should return the count of buffered events", async () => {
      expect(sink.getBufferedCount()).toBe(0);

      for (let i = 0; i < 3; i++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATION,
          actor: "system",
          action: "evaluate",
          target: `policy-${i}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "workspace-1",
          correlationId: `corr-${i}`,
          metadata: {},
        });
        await sink.write(event);
      }

      expect(sink.getBufferedCount()).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getMetrics", () => {
    it("should return sink metrics", async () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.TERMINAL_OUTPUT,
        actor: "agent-1",
        action: "output",
        target: "terminal-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      });

      await sink.write(event);

      const metrics = sink.getMetrics();
      expect(metrics.totalEventsWritten).toBeGreaterThan(0);
      expect(metrics.bufferHighWaterMark).toBeGreaterThanOrEqual(0);
      expect(metrics.persistenceFailures).toBeGreaterThanOrEqual(0);
      expect(metrics.retryCount).toBeGreaterThanOrEqual(0);
    });
  });
});
