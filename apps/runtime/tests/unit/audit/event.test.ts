/**
 * FR-HELIOS-064: Audit Event Schema Tests
 * Verifies: FR-AUD-001 (Audit event structured schema)
 */
import { describe, it, expect } from "bun:test";
import {
  type AuditEvent,
  createAuditEvent,
  validateAuditEvent,
  AUDIT_EVENT_TYPES,
  AUDIT_EVENT_RESULTS,
} from "../../../src/audit/event";

describe("AuditEvent Schema", () => {
  describe("createAuditEvent", () => {
    it("should create a valid event with all required fields", () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "command.sh",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-123",
        metadata: { duration: 100 },
      });

      expect(event.id).toBeTruthy();
      expect(event.timestamp).toBeTruthy();
      expect(event.eventType).toBe(AUDIT_EVENT_TYPES.COMMAND_EXECUTED);
      expect(event.actor).toBe("agent-1");
      expect(event.action).toBe("execute");
      expect(event.target).toBe("command.sh");
      expect(event.result).toBe(AUDIT_EVENT_RESULTS.SUCCESS);
      expect(event.workspaceId).toBe("workspace-1");
      expect(event.correlationId).toBe("corr-123");
      expect(event.metadata.duration).toBe(100);
    });

    it("should generate unique IDs for each event", () => {
      const event1 = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
        actor: "operator-1",
        action: "create",
        target: "session-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      });

      const event2 = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
        actor: "operator-2",
        action: "create",
        target: "session-2",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-2",
        metadata: {},
      });

      expect(event1.id).not.toBe(event2.id);
    });

    it("should generate valid ISO 8601 timestamps", () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATION,
        actor: "system",
        action: "evaluate",
        target: "policy-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      });

      const ts = new Date(event.timestamp);
      expect(isNaN(ts.getTime())).toBe(false);
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("should support optional fields", () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.TERMINAL_OUTPUT,
        actor: "agent-1",
        action: "output",
        target: "terminal-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        laneId: "lane-1",
        sessionId: "session-1",
        correlationId: "corr-1",
        metadata: {},
      });

      expect(event.laneId).toBe("lane-1");
      expect(event.sessionId).toBe("session-1");
    });

    it("should accept arbitrary metadata", () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "cmd",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {
          exitCode: 0,
          duration: 250,
          stderr: "",
          custom: { nested: { value: 42 } },
        },
      });

      expect(event.metadata.exitCode).toBe(0);
      expect(event.metadata.duration).toBe(250);
      expect(
        (
          event.metadata.custom as Record<string, unknown> & {
            nested: { value: number };
          }
        ).nested.value
      ).toBe(42);
    });
  });

  describe("validateAuditEvent", () => {
    it("should accept valid events", () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.APPROVAL_RESOLVED,
        actor: "operator-1",
        action: "approve",
        target: "approval-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      });

      expect(validateAuditEvent(event)).toBe(true);
    });

    it("should reject events with missing actor", () => {
      const event: AuditEvent = {
        id: "id-1",
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "", // Empty actor
        action: "execute",
        target: "cmd",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        timestamp: new Date().toISOString(),
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      };

      expect(validateAuditEvent(event)).toBe(false);
    });

    it("should reject events with missing action", () => {
      const event: AuditEvent = {
        id: "id-1",
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "", // Empty action
        target: "cmd",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        timestamp: new Date().toISOString(),
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      };

      expect(validateAuditEvent(event)).toBe(false);
    });

    it("should reject events with missing target", () => {
      const event: AuditEvent = {
        id: "id-1",
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "", // Empty target
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        timestamp: new Date().toISOString(),
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      };

      expect(validateAuditEvent(event)).toBe(false);
    });

    it("should reject events with invalid timestamp", () => {
      const event: AuditEvent = {
        id: "id-1",
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "cmd",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        timestamp: "invalid-date", // Invalid ISO 8601
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: {},
      };

      expect(validateAuditEvent(event)).toBe(false);
    });

    it("should reject events with invalid metadata (array)", () => {
      const event: any = {
        id: "id-1",
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: "cmd",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        timestamp: new Date().toISOString(),
        workspaceId: "workspace-1",
        correlationId: "corr-1",
        metadata: [], // Invalid: should be object
      };

      expect(validateAuditEvent(event)).toBe(false);
    });

    it("should accept events with optional fields", () => {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.SESSION_CREATED,
        actor: "agent-1",
        action: "create",
        target: "session-1",
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "workspace-1",
        laneId: "lane-1",
        sessionId: "session-1",
        correlationId: "corr-1",
        metadata: {},
      });

      expect(validateAuditEvent(event)).toBe(true);
    });
  });

  describe("Event type constants", () => {
    it("should have all required event types", () => {
      expect(AUDIT_EVENT_TYPES.COMMAND_EXECUTED).toBeDefined();
      expect(AUDIT_EVENT_TYPES.POLICY_EVALUATION).toBeDefined();
      expect(AUDIT_EVENT_TYPES.SESSION_CREATED).toBeDefined();
      expect(AUDIT_EVENT_TYPES.TERMINAL_OUTPUT).toBeDefined();
      expect(AUDIT_EVENT_TYPES.APPROVAL_RESOLVED).toBeDefined();
    });

    it("should have all result constants", () => {
      expect(AUDIT_EVENT_RESULTS.SUCCESS).toBeDefined();
      expect(AUDIT_EVENT_RESULTS.FAILURE).toBeDefined();
      expect(AUDIT_EVENT_RESULTS.DENIED).toBeDefined();
      expect(AUDIT_EVENT_RESULTS.TIMEOUT).toBeDefined();
    });
  });
});
