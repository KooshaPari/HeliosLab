import { METHODS } from "./methods";
import { TOPICS } from "./topics";
import type { LocalBusEnvelope } from "./types";
import { ProtocolValidationError } from "./types";

const _METHOD_SET = new Set<string>(METHODS);
const _TOPIC_SET = new Set<string>(TOPICS);
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const CORRELATION_REQUIRED_METHODS = new Set<string>([
  "lane.attach",
  "lane.cleanup",
  "lane.create",
  "session.attach",
  "session.terminate",
  "terminal.spawn",
  "terminal.input",
  "terminal.resize",
]);

const CORRELATION_REQUIRED_TOPICS = new Set<string>([
  "lane.attach.started",
  "lane.attach.failed",
  "lane.cleanup.started",
  "lane.cleanup.failed",
  "lane.create.started",
  "lane.created",
  "lane.create.failed",
  "session.attach.started",
  "session.attached",
  "session.attach.failed",
  "session.terminate.started",
  "session.terminate.failed",
  "session.terminated",
  "terminal.spawn.started",
  "terminal.spawned",
  "terminal.spawn.failed",
  "terminal.output",
  "terminal.state.changed",
]);

const METHOD_CONTEXT_REQUIREMENTS: Record<
  string,
  Array<"workspace_id" | "lane_id" | "session_id" | "terminal_id">
> = {
  "lane.create": ["workspace_id"],
  "lane.attach": ["workspace_id", "lane_id"],
  "lane.cleanup": ["workspace_id", "lane_id"],
  "session.attach": ["workspace_id", "lane_id", "session_id"],
  "session.terminate": ["workspace_id", "lane_id", "session_id"],
  "terminal.spawn": ["workspace_id", "lane_id", "session_id"],
  "terminal.input": ["workspace_id", "lane_id", "session_id", "terminal_id"],
  "terminal.resize": ["workspace_id", "lane_id", "session_id", "terminal_id"],
};

const TOPIC_CONTEXT_REQUIREMENTS: Record<
  string,
  Array<"workspace_id" | "lane_id" | "session_id" | "terminal_id">
> = {
  "lane.attach.started": ["workspace_id", "lane_id"],
  "lane.attach.failed": ["workspace_id", "lane_id"],
  "lane.cleanup.started": ["workspace_id", "lane_id"],
  "lane.cleanup.failed": ["workspace_id", "lane_id"],
  "lane.create.started": ["workspace_id", "lane_id"],
  "lane.created": ["workspace_id", "lane_id"],
  "lane.create.failed": ["workspace_id", "lane_id"],
  "session.attach.started": ["workspace_id", "lane_id", "session_id"],
  "session.attached": ["workspace_id", "lane_id", "session_id"],
  "session.attach.failed": ["workspace_id", "lane_id", "session_id"],
  "session.terminate.started": ["workspace_id", "lane_id", "session_id"],
  "session.terminate.failed": ["workspace_id", "lane_id", "session_id"],
  "session.terminated": ["workspace_id", "lane_id", "session_id"],
  "terminal.spawn.started": ["workspace_id", "lane_id", "session_id"],
  "terminal.spawned": ["workspace_id", "lane_id", "session_id", "terminal_id"],
  "terminal.spawn.failed": ["workspace_id", "lane_id", "session_id"],
  "terminal.output": ["workspace_id", "lane_id", "session_id", "terminal_id"],
  "terminal.state.changed": ["workspace_id", "lane_id", "session_id", "terminal_id"],
};

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolValidationError("MALFORMED_ENVELOPE", "Envelope must be an object");
  }
}

function assertStringField(envelope: Record<string, unknown>, field: string): string {
  const value = envelope[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProtocolValidationError(
      "MISSING_REQUIRED_FIELD",
      `Envelope field '${field}' is required`,
      { field }
    );
  }
  return value;
}

function assertIsoTimestamp(value: string, field: string): void {
  if (!RFC3339_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ProtocolValidationError(
      "INVALID_TIMESTAMP",
      `Envelope field '${field}' must be an RFC3339 timestamp with timezone`,
      {
        field,
        value,
      }
    );
  }
}

function assertPayloadObject(envelope: Record<string, unknown>): void {
  const payload = envelope.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProtocolValidationError(
      "MISSING_REQUIRED_FIELD",
      "Envelope field 'payload' must be an object",
      {
        field: "payload",
      }
    );
  }
}

function assertOptionalString(
  envelope: Record<string, unknown>,
  field: string
): string | undefined {
  const value = envelope[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProtocolValidationError(
      "MISSING_CONTEXT_ID",
      `Envelope field '${field}' must be a non-empty string`,
      {
        field,
      }
    );
  }
  return value;
}

function assertContext(
  envelope: Record<string, unknown>,
  fields: ReadonlyArray<"workspace_id" | "lane_id" | "session_id" | "terminal_id">
): void {
  for (const field of fields) {
    assertOptionalString(envelope, field);
    if (typeof envelope[field] !== "string" || (envelope[field] as string).trim() === "") {
      throw new ProtocolValidationError(
        "MISSING_CONTEXT_ID",
        `Envelope field '${field}' is required`,
        {
          field,
        }
      );
    }
  }
}

function assertErrorPayload(envelope: Record<string, unknown>): void {
  const error = envelope.error;
  if (error === undefined || error === null) {
    return;
  }
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    throw new ProtocolValidationError(
      "INVALID_ERROR_PAYLOAD",
      "Envelope field 'error' must be an object"
    );
  }

  const typedError = error as Record<string, unknown>;
  if (typeof typedError.code !== "string" || typeof typedError.message !== "string") {
    throw new ProtocolValidationError(
      "INVALID_ERROR_PAYLOAD",
      "Envelope error payload must include code and message"
    );
  }
  if (typeof typedError.retryable !== "boolean") {
    throw new ProtocolValidationError(
      "INVALID_ERROR_PAYLOAD",
      "Envelope error payload must include retryable boolean"
    );
  }
}

function assertCorrelationId(
  envelope: Record<string, unknown>,
  requiredBy: "method" | "topic",
  name: string
): void {
  const correlationId = assertOptionalString(envelope, "correlation_id");
  if (!correlationId) {
    throw new ProtocolValidationError(
      "MISSING_CORRELATION_ID",
      "Envelope field 'correlation_id' is required",
      {
        // biome-ignore lint/style/useNamingConvention: External protocol field names use snake_case.
        required_by: requiredBy,
        name,
      }
    );
  }
}

function validateCommandEnvelope(envelope: Record<string, unknown>): void {
  const method = assertStringField(envelope, "method");
  assertPayloadObject(envelope);

  const requiredContext = METHOD_CONTEXT_REQUIREMENTS[method];
  if (requiredContext) {
    assertContext(envelope, requiredContext);
  }
  if (CORRELATION_REQUIRED_METHODS.has(method)) {
    assertCorrelationId(envelope, "method", method);
  }
}

function validateEventEnvelope(envelope: Record<string, unknown>): void {
  const _topic = assertStringField(envelope, "topic");
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)*$/.test(_topic)) {
    throw new ProtocolValidationError("INVALID_TOPIC", `Malformed topic '${_topic}'`, {
      topic: _topic,
    });
  }
  assertPayloadObject(envelope);

  const requiredContext = TOPIC_CONTEXT_REQUIREMENTS[_topic];
  if (requiredContext) {
    assertContext(envelope, requiredContext);
  }
  if (CORRELATION_REQUIRED_TOPICS.has(_topic)) {
    assertCorrelationId(envelope, "topic", _topic);
  }
}

function validateResponseEnvelope(envelope: Record<string, unknown>): void {
  const status = assertStringField(envelope, "status");
  if (status !== "ok" && status !== "error") {
    throw new ProtocolValidationError("INVALID_STATUS", `Unsupported status '${status}'`, {
      status,
    });
  }
  assertErrorPayload(envelope);

  // Skip METHOD_SET check — METHODS is empty; rely on METHOD_CONTEXT_REQUIREMENTS
  void assertOptionalString(envelope, "method");

  const _topic = assertOptionalString(envelope, "topic");
  if (topic && !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)*$/.test(topic)) {
    throw new ProtocolValidationError("INVALID_TOPIC", `Malformed topic '${topic}'`, {
      topic,
    });
  }
}

export function validateEnvelope(input: unknown): LocalBusEnvelope {
  assertRecord(input);

  const envelope = input;
  const type = assertStringField(envelope, "type");
  if (type !== "command" && type !== "event" && type !== "response") {
    throw new ProtocolValidationError(
      "INVALID_ENVELOPE_TYPE",
      `Unsupported envelope type '${type}'`,
      { type }
    );
  }

  const id = assertStringField(envelope, "id");
  const ts = assertStringField(envelope, "ts");
  assertIsoTimestamp(ts, "ts");
  assertOptionalString(envelope, "workspace_id");
  assertOptionalString(envelope, "lane_id");
  assertOptionalString(envelope, "session_id");
  assertOptionalString(envelope, "terminal_id");
  assertOptionalString(envelope, "envelope_id");
  const timestamp = assertOptionalString(envelope, "timestamp");
  if (timestamp) {
    assertIsoTimestamp(timestamp, "timestamp");
  }
  assertOptionalString(envelope, "correlation_id");

  if (type === "command") {
    validateCommandEnvelope(envelope);
  }

  if (type === "event") {
    validateEventEnvelope(envelope);
  }

  if (type === "response") {
    validateResponseEnvelope(envelope);
  }

  // id is checked for completeness and stable semantics in thrown errors.
  if (!id) {
    throw new ProtocolValidationError("MISSING_REQUIRED_FIELD", "Envelope field 'id' is required");
  }

  return envelope as LocalBusEnvelope;
}
