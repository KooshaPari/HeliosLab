import { METHODS } from "../protocol/methods.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import type { RedactionEngine } from "../secrets/redaction-engine.js";
import type { RecoveryRegistry } from "../sessions/registry.js";
import { applyRecoveryFromCommand } from "./recovery_bookkeeping.js";
import {
	handleTerminalCommand,
	type RuntimeTerminalContext,
} from "./terminal.js";

export type RuntimeOpsContext = RuntimeTerminalContext & {
	recovery: RecoveryRegistry;
	redactionEngine: RedactionEngine;
	rawBusRequest?: (command: LocalBusEnvelope) => Promise<LocalBusEnvelope>;
};

const METHOD_SET = new Set<string>(METHODS);

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
		return value.map((item) => redactStructuredValue(item));
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(
				([entryKey, entryValue]) => [
					entryKey,
					redactStructuredValue(entryValue, entryKey),
				],
			),
		);
	}

	return value;
}

function redactPayload(
	engine: RedactionEngine,
	payload: Record<string, unknown>,
	correlationId: string,
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

function recordCommand(
	context: RuntimeOpsContext,
	envelope: LocalBusEnvelope,
): void {
	context.appendAuditRecord({
		recorded_at: new Date().toISOString(),
		type: "command",
		method: envelope.method,
		correlation_id: envelope.correlation_id,
		// Do not persist raw envelope; sensitive data is stripped below
		payload: redactPayload(
			context.redactionEngine,
			normalizePayload(envelope.payload),
			envelope.correlation_id ?? envelope.id,
		),
		error: null,
	});
}

function recordResponse(
	context: RuntimeOpsContext,
	envelope: LocalBusEnvelope,
): void {
	context.appendAuditRecord({
		recorded_at: new Date().toISOString(),
		type: "response",
		method: envelope.method,
		correlation_id: envelope.correlation_id,
		// Do not persist raw envelope; sensitive data is stripped below
		payload: redactPayload(
			context.redactionEngine,
			normalizePayload(envelope.result ?? envelope.payload),
			envelope.correlation_id ?? envelope.id,
		),
		error: envelope.error ?? null,
	});
}

export async function handleRuntimeRequest(
	context: RuntimeOpsContext,
	command: LocalBusEnvelope,
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

	const terminalResponse = await handleTerminalCommand(
		context as RuntimeTerminalContext,
		command,
	);
	if (terminalResponse) {
		return terminalResponse;
	}

	if (
		command.type === "command" &&
		command.method &&
		!METHOD_SET.has(command.method)
	) {
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
	applyRecoveryFromCommand(context.recovery, command, response);
	recordResponse(context, response);
	return response;
}
