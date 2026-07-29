/**
 * Envelope creation helpers and strict validation for the Helios bus.
 *
 * Every bus message is created through these helpers, which guarantee
 * well-formed envelopes with auto-generated IDs and timestamps.
 */

import type { CommandEnvelope, ResponseEnvelope, EventEnvelope, Envelope } from "./types.js";
import { validationError, backpressureError } from "./errors.js";
import type { BusError } from "./errors.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum serialised payload size in bytes (default 1 MB). */
// biome-ignore lint/style/useNamingConvention: Protocol payload field must remain snake_case for external schema compatibility.
export let MAX_PAYLOAD_SIZE = 1_048_576;

/** Override the maximum payload size (for testing or configuration). */
export function setMaxPayloadSize(bytes: number): void {
  MAX_PAYLOAD_SIZE = bytes;
}

// ---------------------------------------------------------------------------
// ID generation stub
// ---------------------------------------------------------------------------

// TODO: Import from packages/ids/ when spec 005 is available.
// Stub generates a spec-005-style ID: {prefix}_{ulid-like-random}.
function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}${rand}`;
}

// ---------------------------------------------------------------------------
// Monotonic clock
// ---------------------------------------------------------------------------

function monotonicNow(): number {
  return performance.now();
}

// ---------------------------------------------------------------------------
// Creation helpers
// ---------------------------------------------------------------------------

/**
 * Create a well-formed CommandEnvelope.
 *
 * @param method - The command method name (must be non-empty).
 * @param payload - Arbitrary payload (typed as unknown to force consumer narrowing).
 * @param correlationId - Optional; auto-generated if omitted.
 */
export function createCommand(
  method: string,
  payload: Record<string, unknown>,
  correlationId?: string
): CommandEnvelope {
  if (!method) {
    throw new Error("createCommand: method must be a non-empty string");
  }
  return {
    id: generateId("cmd"),
    // biome-ignore lint/style/useNamingConvention: Protocol schema requires correlation_id.
    correlation_id: correlationId ?? generateId("cor"),
    timestamp: monotonicNow(),
    type: "command",
    method,
    payload,
  };
}

/**
 * Create a ResponseEnvelope from an originating command.
 *
 * @param command - The originating CommandEnvelope.
 * @param payload - Response payload.
 * @param error - Optional BusError if the command failed.
 */
export function createResponse(
  command: CommandEnvelope,
  payload: Record<string, unknown> | null | undefined,
  error?: BusError
): ResponseEnvelope {
  const base: ResponseEnvelope = {
    id: generateId("res"),
    // biome-ignore lint/style/useNamingConvention: Protocol schema requires correlation_id.
    correlation_id: command.correlation_id,
    timestamp: monotonicNow(),
    type: "response",
    method: command.method,
    payload,
  };
  if (error !== undefined) {
    return { ...base, error };
  }
  return base;
}

/**
 * Create an EventEnvelope.
 *
 * Sequence is set to 0 as a placeholder; the topic registry assigns the
 * real sequence number at publish time.
 *
 * @param topic - Event topic (must be non-empty).
 * @param payload - Event payload.
 * @param correlationId - Optional correlation for tracing.
 */
export function createEvent(
  topic: string,
  payload: Record<string, unknown> | undefined,
  correlationId?: string
): EventEnvelope {
  if (!topic) {
    throw new Error("createEvent: topic must be a non-empty string");
  }
  return {
    id: generateId("evt"),
    // biome-ignore lint/style/useNamingConvention: Protocol schema requires correlation_id.
    correlation_id: correlationId ?? generateId("cor"),
    timestamp: monotonicNow(),
    type: "event",
    topic,
    payload,
    sequence: 0,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidationSuccess = { valid: true; envelope: Envelope };
type ValidationFailure = { valid: false; error: Readonly<BusError> };
type ValidationResult = ValidationSuccess | ValidationFailure;

function fail(message: string, details?: unknown): ValidationFailure {
  return { valid: false, error: validationError(message, details) };
}

/**
 * Validate an unknown value as a well-formed Envelope.
 *
 * Fail-fast: returns a structured VALIDATION_ERROR on any defect.
 */
export function validateEnvelope(input: unknown): ValidationResult {
  if (input === null || input === undefined || typeof input !== "object") {
    return fail("Envelope must be a non-null object");
  }

  const envelope = input as Record<string, unknown>;

  // --- Required base fields ---
  if (typeof envelope["id"] !== "string" || envelope["id"] === "") {
    return fail('Missing or empty "id" field');
  }
  if (typeof envelope["correlation_id"] !== "string" || envelope["correlation_id"] === "") {
    return fail('Missing or empty "correlation_id" field');
  }
  if (typeof envelope["timestamp"] !== "number" || !(envelope["timestamp"] > 0)) {
    return fail('Missing or invalid "timestamp" field (must be a positive number)');
  }

  const type = envelope["type"];
  if (type !== "command" && type !== "response" && type !== "event") {
    return fail(`Unknown envelope type: ${String(type)}`, { type });
  }

  // --- Type-specific fields ---
  if (type === "command") {
    if (typeof envelope["method"] !== "string" || envelope["method"] === "") {
      return fail('Command envelope requires a non-empty "method" field');
    }
    if (!("payload" in envelope)) {
      return fail('Command envelope requires a "payload" field');
    }
  }

  if (type === "response") {
    if (typeof envelope["method"] !== "string" || envelope["method"] === "") {
      return fail('Response envelope requires a non-empty "method" field');
    }
  }

  if (type === "event") {
    if (typeof envelope["topic"] !== "string" || envelope["topic"] === "") {
      return fail('Event envelope requires a non-empty "topic" field');
    }
    if (!("payload" in envelope)) {
      return fail('Event envelope requires a "payload" field');
    }
  }

  // --- Payload size check ---
  if ("payload" in envelope && envelope["payload"] !== undefined && envelope["payload"] !== null) {
    const payload = envelope["payload"];
    const topicOrMethod =
      typeof envelope["topic"] === "string"
        ? envelope["topic"]
        : typeof envelope["method"] === "string"
          ? envelope["method"]
          : "unknown";

    // Fast-path: Buffer/ArrayBuffer — check byteLength directly.
    if (payload instanceof ArrayBuffer) {
      if (payload.byteLength > MAX_PAYLOAD_SIZE) {
        return {
          valid: false,
          error: backpressureError(topicOrMethod),
        };
      }
    } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(payload)) {
      if (payload.byteLength > MAX_PAYLOAD_SIZE) {
        return {
          valid: false,
          error: backpressureError(topicOrMethod),
        };
      }
    } else if (typeof payload === "string") {
      // Fast-path: strings — check length directly (no serialization needed).
      if (payload.length > MAX_PAYLOAD_SIZE) {
        return {
          valid: false,
          error: backpressureError(topicOrMethod),
        };
      }
    } else if (typeof payload === "number" || typeof payload === "boolean") {
      // Primitives are always small — skip size check.
    } else {
      // Object payloads — serialize to check size.
      try {
        const serialised = JSON.stringify(payload);
        if (serialised !== undefined && serialised.length > MAX_PAYLOAD_SIZE) {
          return {
            valid: false,
            error: backpressureError(topicOrMethod),
          };
        }
      } catch {
        // Circular reference or other serialisation error
        return fail("Payload cannot be serialised (possible circular reference)");
      }
    }
  }

  return { valid: true, envelope: envelope as unknown as Envelope };
}
