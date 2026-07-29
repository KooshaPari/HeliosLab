import type { CommandEnvelope, EventEnvelope } from "./types.js";

// ---------------------------------------------------------------------------
// Envelope Validation Functions
// ---------------------------------------------------------------------------

export function isCommandEnvelope(val: unknown): val is CommandEnvelope {
  return (
    val !== null &&
    typeof val === "object" &&
    (val as Record<string, unknown>).type === "command" &&
    typeof (val as Record<string, unknown>).method === "string" &&
    typeof (val as Record<string, unknown>).id === "string" &&
    "payload" in (val as Record<string, unknown>)
  );
}

export function isEventEnvelope(val: unknown): val is EventEnvelope {
  return (
    val !== null &&
    typeof val === "object" &&
    (val as Record<string, unknown>).type === "event" &&
    typeof (val as Record<string, unknown>).topic === "string"
  );
}

export function hasTopLevelDataField(envelope: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(envelope, "data");
}
