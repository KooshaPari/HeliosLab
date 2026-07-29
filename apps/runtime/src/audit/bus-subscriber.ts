import type { AuditSink } from "./sink";
import { createAuditEvent, AUDIT_EVENT_TYPES } from "./event";

/**
 * Bus event topic to audit event type mapping.
 * Enables automatic capture of bus events without manual instrumentation.
 */
const TOPIC_TO_AUDIT_TYPE: Record<string, string> = {
  "lane.created": AUDIT_EVENT_TYPES.LANE_LIFECYCLE,
  "lane.updated": AUDIT_EVENT_TYPES.LANE_LIFECYCLE,
  "lane.deleted": AUDIT_EVENT_TYPES.LANE_LIFECYCLE,
  "lane.lifecycle": AUDIT_EVENT_TYPES.LANE_LIFECYCLE,

  "session.created": AUDIT_EVENT_TYPES.SESSION_LIFECYCLE,
  "session.updated": AUDIT_EVENT_TYPES.SESSION_LIFECYCLE,
  "session.deleted": AUDIT_EVENT_TYPES.SESSION_LIFECYCLE,
  "session.lifecycle": AUDIT_EVENT_TYPES.SESSION_LIFECYCLE,

  "terminal.output": AUDIT_EVENT_TYPES.TERMINAL_LIFECYCLE,
  "terminal.created": AUDIT_EVENT_TYPES.TERMINAL_LIFECYCLE,
  "terminal.closed": AUDIT_EVENT_TYPES.TERMINAL_LIFECYCLE,
  "terminal.lifecycle": AUDIT_EVENT_TYPES.TERMINAL_LIFECYCLE,

  "policy.evaluation.completed": AUDIT_EVENT_TYPES.POLICY_EVALUATION,
  "policy.evaluation": AUDIT_EVENT_TYPES.POLICY_EVALUATION,
  "policy.created": AUDIT_EVENT_TYPES.POLICY_LIFECYCLE,
  "policy.updated": AUDIT_EVENT_TYPES.POLICY_LIFECYCLE,
  "policy.deleted": AUDIT_EVENT_TYPES.POLICY_LIFECYCLE,
  "policy.lifecycle": AUDIT_EVENT_TYPES.POLICY_LIFECYCLE,

  "approval.created": AUDIT_EVENT_TYPES.APPROVAL_LIFECYCLE,
  "approval.resolved": AUDIT_EVENT_TYPES.APPROVAL_LIFECYCLE,
  "approval.lifecycle": AUDIT_EVENT_TYPES.APPROVAL_LIFECYCLE,
};

/**
 * Bus event payload structure expected from the local bus.
 */
export interface BusEvent {
  topic: string;
  payload: Record<string, unknown>;
  actor?: string;
  action?: string;
  target?: string;
  workspaceId?: string;
  laneId?: string;
  sessionId?: string;
  correlationId?: string;
  timestamp?: string;
}

/**
 * Subscribes to local bus events and automatically captures them as audit events.
 * Enables forensic analysis without requiring manual instrumentation in every producer.
 */
export class BusAuditSubscriber {
  private unsubscribe: (() => void) | null = null;

  /**
   * Start subscribing to bus events.
   * Must be called during runtime initialization.
   *
   * @param bus - The local event bus instance
   * @param sink - The audit sink for persisting events
   */
  subscribe(bus: any, sink: AuditSink): void {
    // Subscribe to all topics
    this.unsubscribe = bus.subscribe("*", async (event: BusEvent) => {
      try {
        await this.handleBusEvent(event, sink);
      } catch (err) {
        // Log error but do not throw; do not block bus dispatch
        console.error("[BusAuditSubscriber] Error handling bus event:", err);
      }
    });
  }

  /**
   * Stop subscribing to bus events.
   */
  unsubscribe_(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Handle an incoming bus event and create corresponding audit event.
   *
   * @param event - Bus event
   * @param sink - Audit sink
   */
  private async handleBusEvent(event: BusEvent, sink: AuditSink): Promise<void> {
    // Map topic to audit event type
    const auditEventType = TOPIC_TO_AUDIT_TYPE[event.topic];

    if (!auditEventType) {
      // Unknown topic: log warning but continue
      console.warn(`[BusAuditSubscriber] Unknown bus topic: ${event.topic}`);
      // Optionally create a generic audit event for unknown topics
      // For now, skip unknown topics to avoid noise
      return;
    }

    // Extract relevant fields from bus event
    const actor = event.actor || "system";
    const action = event.action || this.deriveActionFromTopic(event.topic);
    const target = event.target || event.topic;
    const workspaceId = event.workspaceId || "unknown";
    const correlationId = event.correlationId || `bus-${Date.now()}-${Math.random()}`;

    // Create audit event
    const auditEvent = createAuditEvent({
      eventType: auditEventType,
      actor,
      action,
      target,
      result: "success", // Bus events default to success; failures have separate topics
      workspaceId,
      laneId: event.laneId,
      sessionId: event.sessionId,
      correlationId,
      metadata: {
        busTopic: event.topic,
        busPayload: event.payload,
      },
    });

    // Write to sink (non-blocking)
    await sink.write(auditEvent);
  }

  /**
   * Derive an action name from a bus topic.
   * Used when action is not explicitly provided.
   *
   * @param topic - Bus event topic
   * @returns Derived action name
   */
  private deriveActionFromTopic(topic: string): string {
    // Extract last segment and convert to action
    const parts = topic.split(".");
    const lastPart = parts[parts.length - 1];

    switch (lastPart) {
      case "created":
        return "create";
      case "updated":
        return "update";
      case "deleted":
        return "delete";
      case "resolved":
        return "resolve";
      case "completed":
        return "complete";
      case "output":
        return "output";
      case "closed":
        return "close";
      default:
        return lastPart || "unknown";
    }
  }
}
