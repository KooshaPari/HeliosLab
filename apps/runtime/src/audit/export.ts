import type { AuditEvent } from "./event";
import type { SessionSnapshot } from "./snapshot";

/**
 * Redaction rule for sensitive data masking.
 */
export interface RedactionRule {
  pattern: RegExp;
  replacement: string;
  description: string;
}

/**
 * Metadata for export bundles.
 */
export interface ExportMetadata {
  workspaceId: string;
  exportTimestamp: string;
  eventCount: number;
  redactionRulesApplied: string[];
}

/**
 * Complete export bundle.
 */
export interface ExportBundle {
  metadata: ExportMetadata;
  events: AuditEvent[];
  snapshots?: SessionSnapshot[];
}

/**
 * Audit event exporter with redaction support.
 */
export class AuditExporter {
  private redactionRules: RedactionRule[] = [];

  constructor() {
    // Initialize with placeholder redaction rules
    this.redactionRules = [
      {
        pattern: /api[_-]?key[=:]\s*['"]?[a-zA-Z0-9-]+['"]?/gi,
        replacement: "API_KEY_REDACTED",
        description: "API keys",
      },
      {
        pattern: /password[=:]\s*['"]?[^'"\s]+['"]?/gi,
        replacement: "PASSWORD_REDACTED",
        description: "Passwords",
      },
      {
        pattern: /token[=:]\s*['"]?[a-zA-Z0-9-]+['"]?/gi,
        replacement: "TOKEN_REDACTED",
        description: "Tokens",
      },
      {
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        replacement: "EMAIL_REDACTED",
        description: "Email addresses",
      },
    ];
  }

  /**
   * Export workspace events with redaction applied.
   *
   * @param workspaceId - Workspace to export
   * @param events - Events to export
   * @returns Export bundle with redacted events
   */
  exportWorkspace(workspaceId: string, events: AuditEvent[]): ExportBundle {
    if (this.redactionRules.length === 0) {
      throw new Error("Redaction rules required before export is permitted.");
    }

    const redactedEvents = events.map(event => this.redactEvent(event));

    return {
      metadata: {
        workspaceId,
        exportTimestamp: new Date().toISOString(),
        eventCount: events.length,
        redactionRulesApplied: this.redactionRules.map(r => r.description),
      },
      events: redactedEvents,
    };
  }

  /**
   * Export session with all events and snapshots.
   *
   * @param sessionId - Session to export
   * @param events - Session events
   * @param snapshots - Session snapshots
   * @returns Export bundle
   */
  exportSession(
    sessionId: string,
    events: AuditEvent[],
    snapshots?: SessionSnapshot[]
  ): ExportBundle {
    if (this.redactionRules.length === 0) {
      throw new Error("Redaction rules required before export is permitted.");
    }

    const redactedEvents = events.map(event => this.redactEvent(event));
    const redactedSnapshots = snapshots?.map(snap => this.redactSnapshot(snap));

    return {
      metadata: {
        workspaceId: events[0]?.workspaceId || "unknown",
        exportTimestamp: new Date().toISOString(),
        eventCount: events.length,
        redactionRulesApplied: this.redactionRules.map(r => r.description),
      },
      events: redactedEvents,
      snapshots: redactedSnapshots,
    };
  }

  /**
   * Add a custom redaction rule.
   *
   * @param rule - Redaction rule to add
   */
  addRedactionRule(rule: RedactionRule): void {
    this.redactionRules.push(rule);
  }

  /**
   * Redact sensitive data from an event.
   */
  private redactEvent(event: AuditEvent): AuditEvent {
    const redacted = { ...event };

    // Redact string fields
    redacted.actor = this.redactString(redacted.actor);
    redacted.action = this.redactString(redacted.action);
    redacted.target = this.redactString(redacted.target);

    // Redact metadata
    redacted.metadata = Object.fromEntries(
      Object.entries(redacted.metadata || {}).map(([key, value]) => [
        key,
        typeof value === "string" ? this.redactString(value) : value,
      ])
    );

    return redacted;
  }

  /**
   * Redact sensitive data from a snapshot.
   */
  private redactSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
    const redacted = { ...snapshot };

    // Redact terminal buffer
    redacted.terminalBuffer = this.redactString(redacted.terminalBuffer);

    return redacted;
  }

  /**
   * Apply all redaction rules to a string.
   */
  private redactString(value: string): string {
    let redacted = value;

    for (const rule of this.redactionRules) {
      redacted = redacted.replace(rule.pattern, rule.replacement);
    }

    return redacted;
  }
}
