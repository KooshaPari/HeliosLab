import type { LocalBusEnvelope } from "../protocol/types.js";
import { METHODS } from "../protocol/methods.js";
import type { RecoveryRegistry } from "../sessions/registry.js";

import { RedactionEngine } from "../secrets/redaction-engine.js";

import { handleTerminalCommand, type RuntimeTerminalContext } from "./terminal.js";

export type RuntimeOpsContext = RuntimeTerminalContext & {
  recovery: RecoveryRegistry;
  redactionEngine: RedactionEngine;
  rawBusRequest?: (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>;
};

const _METHOD_SET = new Set<string>(METHODS);

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function redactStructuredValue(value: unknown, key?: string): unknown {
  const normalizedKey = key?.toLowerCase() ?? "";
  const shouldRedactKey =
    normalizedKey.includes("api_key") ||
    normalizedKey.includes("token") ||
    normalizedKey.includes("secret") ||
    normalizedKey.includes("password");

  if (shouldRedactKey && typeof value === "string" && value.length > 0) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map(item => redactStructuredValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactStructuredValue(entryValue, entryKey),
      ])
    );
  }

  return value;
}

function redactPayload(
  engine: RedactionEngine,
  payload: Record<string, unknown>,
  correlationId: string
): Record<string, unknown> {
  const structured = redactStructuredValue(payload) as Record<string, unknown>;
  const serialized = JSON.stringify(structured);
  const result = engine.redact(serialized, {
    artifactId: `audit-${correlationId}`,
    artifactType: "audit",
    correlationId,
  });
  return JSON.parse(result.redacted) as Record<string, unknown>;
}

function recordCommand(context: RuntimeOpsContext, envelope: LocalBusEnvelope): void {
  context.appendAuditRecord({
    recorded_at: new Date().toISOString(),
    type: "command",
    method: envelope.method,
    correlation_id: envelope.correlation_id,
    // Do not persist raw envelope; sensitive data is stripped below
    payload: redactPayload(
      context.redactionEngine,
      normalizePayload(envelope.payload),
      envelope.correlation_id ?? envelope.id
    ),
    error: null,
  });
}

function recordResponse(context: RuntimeOpsContext, envelope: LocalBusEnvelope): void {
  context.appendAuditRecord({
    recorded_at: new Date().toISOString(),
    type: "response",
    method: envelope.method,
    correlation_id: envelope.correlation_id,
    // Do not persist raw envelope; sensitive data is stripped below
    payload: redactPayload(
      context.redactionEngine,
      normalizePayload(envelope.result ?? envelope.payload),
      envelope.correlation_id ?? envelope.id
    ),
    error: envelope.error ?? null,
  });
}

function applyRecoveryFromCommand(
  context: RuntimeOpsContext,
  command: LocalBusEnvelope,
  response: LocalBusEnvelope
): void {
  if (response.type !== "response" || response.status !== "ok" || !command.method) {
    return;
  }

  const payload = normalizePayload(command.payload);
  const result = normalizePayload(response.result);

  context.recovery.apply(command.method, {
    workspace_id: command.workspace_id,
    lane_id:
      command.lane_id ??
      (typeof payload.lane_id === "string" ? payload.lane_id : undefined) ??
      (typeof payload.id === "string" && command.method === "lane.create"
        ? payload.id
        : undefined) ??
      (typeof result.lane_id === "string" ? result.lane_id : undefined),
    session_id:
      command.session_id ??
      (typeof payload.session_id === "string" ? payload.session_id : undefined) ??
      (typeof payload.id === "string" && command.method === "session.attach"
        ? payload.id
        : undefined) ??
      (typeof result.session_id === "string" ? result.session_id : undefined),
    terminal_id:
      command.terminal_id ??
      (typeof payload.terminal_id === "string" ? payload.terminal_id : undefined) ??
      (typeof payload.id === "string" && command.method === "terminal.spawn"
        ? payload.id
        : undefined) ??
      (typeof result.terminal_id === "string" ? result.terminal_id : undefined),
    codex_session_id:
      typeof payload.codex_session_id === "string" ? payload.codex_session_id : undefined,
  });
}

export async function handleRuntimeRequest(
  context: RuntimeOpsContext,
  command: LocalBusEnvelope
): Promise<LocalBusEnvelope> {
  recordCommand(context, command);

  if (command.type === "command" && command.method && !command.correlation_id) {
    const response: LocalBusEnvelope = {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      correlation_id: command.correlation_id,
      method: command.method,
      status: "error",
      error: {
        code: "MISSING_CORRELATION_ID",
        message: "Correlation ID is required",
        retryable: false,
      },
    };
    recordResponse(context, response);
    return response;
  }

  const terminalResponse = await handleTerminalCommand(context as RuntimeTerminalContext, command);
  if (terminalResponse) {
    return terminalResponse;
  }

  if (command.type === "command" && command.method && !METHOD_SET.has(command.method)) {
    const response: LocalBusEnvelope = {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      correlation_id: command.correlation_id,
      method: command.method,
      status: "error",
      error: {
        code: "METHOD_NOT_SUPPORTED",
        message: `Unsupported method '${command.method}'`,
        retryable: false,
      },
    };
    recordResponse(context, response);
    return response;
  }

  if (
    command.type === "command" &&
    command.method === "session.attach" &&
    command.payload?.boundary_failure === "harness"
  ) {
    const response: LocalBusEnvelope = {
      id: command.id,
      type: "response",
      ts: new Date().toISOString(),
      correlation_id: command.correlation_id,
      method: command.method,
      status: "error",
      error: {
        code: "HARNESS_UNAVAILABLE",
        message: "Harness boundary unavailable",
        retryable: false,
      },
    };
    recordResponse(context, response);
    return response;
  }

  const response = await (context.rawBusRequest
    ? context.rawBusRequest(command)
    : context.bus.request(command));
  response.correlation_id ??= command.correlation_id;
  response.method ??= command.method;
  applyRecoveryFromCommand(context, command, response);
  recordResponse(context, response);
  return response;
}
