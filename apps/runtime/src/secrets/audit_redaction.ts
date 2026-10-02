/**
 * Structured audit redaction helpers.
 *
 * Extracted from the runtime entry point to keep `index.ts` within its
 * file-length budget. These are pure helpers: they key-match sensitive field
 * names, then run the payload through the {@link RedactionEngine}.
 *
 * @module
 */

import type { RedactionEngine } from "./redaction-engine.js";

/** Normalize an unknown value into a plain payload object. */
export function normalizePayload(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return { ...(value as Record<string, unknown>) };
}

/**
 * Recursively redact values whose key names look sensitive.
 *
 * Key matching is a cheap pre-pass; the engine still applies its own rules to
 * the serialized result.
 */
export function redactStructuredValue(value: unknown, key?: string): unknown {
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

/** Redact a payload through the engine, returning a plain object. */
export function redactPayload(
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
