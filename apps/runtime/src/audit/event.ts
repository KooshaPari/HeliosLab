import { randomUUID } from "crypto";

/**
 * Audit event type constants to prevent typos and enable type safety.
 * These categorize the event for filtering, searching, and analysis.
 */
export const AUDIT_EVENT_TYPES = {
  COMMAND_EXECUTED: "command.executed",
  POLICY_EVALUATION: "policy.evaluation",
  SESSION_CREATED: "session.created",
  TERMINAL_OUTPUT: "terminal.output",
  APPROVAL_RESOLVED: "approval.resolved",
  LANE_LIFECYCLE: "lane.lifecycle",
  SESSION_LIFECYCLE: "session.lifecycle",
  TERMINAL_LIFECYCLE: "terminal.lifecycle",
  POLICY_LIFECYCLE: "policy.lifecycle",
  APPROVAL_LIFECYCLE: "approval.lifecycle",
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

/**
 * Result values for audit events indicating the outcome of an action.
 */
export const AUDIT_EVENT_RESULTS = {
  SUCCESS: "success",
  FAILURE: "failure",
  DENIED: "denied",
  TIMEOUT: "timeout",
  PENDING: "pending",
} as const;

export type AuditEventResult = (typeof AUDIT_EVENT_RESULTS)[keyof typeof AUDIT_EVENT_RESULTS];

/**
 * Immutable audit event record for forensic analysis and compliance.
 * All fields are required except optional context fields (laneId, sessionId).
 */
export interface AuditEvent {
  /**
   * Unique identifier (UUID v7 for time-ordered generation and sorting).
   */
  id: string;

  /**
   * Categorization of the event type for filtering and searching.
   * Examples: 'command.executed', 'policy.evaluation', 'session.created'
   */
  eventType: AuditEventType | string;

  /**
   * Identifies who performed the action: agent ID, operator ID, or 'system'.
   */
  actor: string;

  /**
   * Describes what was done: 'execute', 'create', 'approve', 'deny', etc.
   */
  action: string;

  /**
   * Identifies what was affected: file path, session ID, command text, etc.
   */
  target: string;

  /**
   * Outcome of the action: 'success', 'failure', 'denied', 'timeout'.
   */
  result: AuditEventResult | string;

  /**
   * ISO 8601 timestamp with millisecond precision.
   */
  timestamp: string;

  /**
   * Workspace ID for multi-tenancy and isolation.
   */
  workspaceId: string;

  /**
   * Optional lane ID for lane-scoped operations.
   */
  laneId?: string;

  /**
   * Optional session ID for session tracking.
   */
  sessionId?: string;

  /**
   * Correlation ID linking related events across the system.
   * Enables tracing of event chains and causality.
   */
  correlationId: string;

  /**
   * Event-type-specific metadata for extensibility.
   * Common fields: error, statusCode, duration, etc.
   */
  metadata: Record<string, unknown>;
}

/**
 * Input type for creating audit events, omitting auto-generated fields.
 */
export type AuditEventInput = Omit<AuditEvent, "id" | "timestamp">;

/**
 * Factory function to create a valid AuditEvent.
 * Generates UUID v7 for time-ordered IDs and current ISO 8601 timestamp.
 *
 * @param input - Event data excluding auto-generated fields
 * @returns Fully populated AuditEvent
 */
export function createAuditEvent(input: AuditEventInput): AuditEvent {
  const now = new Date();

  return {
    id: generateUUIDv7(),
    timestamp: now.toISOString(),
    ...input,
  };
}

/**
 * Validates that an AuditEvent has all required fields and correct types.
 *
 * @param event - Event to validate
 * @returns true if valid, false otherwise
 */
export function validateAuditEvent(event: AuditEvent): boolean {
  // Check required string fields
  if (
    typeof event.id !== "string" ||
    !event.id ||
    typeof event.eventType !== "string" ||
    !event.eventType ||
    typeof event.actor !== "string" ||
    !event.actor ||
    typeof event.action !== "string" ||
    !event.action ||
    typeof event.target !== "string" ||
    !event.target ||
    typeof event.result !== "string" ||
    !event.result ||
    typeof event.timestamp !== "string" ||
    !event.timestamp ||
    typeof event.workspaceId !== "string" ||
    !event.workspaceId ||
    typeof event.correlationId !== "string" ||
    !event.correlationId
  ) {
    return false;
  }

  // Check optional fields if present
  if (event.laneId !== undefined && typeof event.laneId !== "string") {
    return false;
  }

  if (event.sessionId !== undefined && typeof event.sessionId !== "string") {
    return false;
  }

  // Check metadata is a plain object
  if (
    typeof event.metadata !== "object" ||
    event.metadata === null ||
    Array.isArray(event.metadata)
  ) {
    return false;
  }

  // Validate timestamp is valid ISO 8601
  const ts = new Date(event.timestamp);
  if (isNaN(ts.getTime())) {
    return false;
  }

  return true;
}

/**
 * Generates a UUID v7 identifier.
 * UUID v7 is time-ordered, allowing lexicographic sorting by generation time.
 *
 * Uses randomUUID from crypto module as a placeholder.
 * In production, use a dedicated UUID v7 library.
 *
 * @returns UUID v7 string
 */
function generateUUIDv7(): string {
  // For now, use randomUUID as a placeholder.
  // TODO: Replace with proper UUID v7 generation for time-ordered IDs.
  return randomUUID();
}
