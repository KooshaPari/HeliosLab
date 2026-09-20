/**
 * Redaction helpers used by `createRuntime()` to sanitize audit
 * envelope payloads before they are appended to the in-memory audit
 * ledger. Extracted from `apps/runtime/src/index.ts` so the runtime
 * entry stays under the file-length no-growth baseline.
 */

import type { RedactionEngine } from "./secrets/redaction-engine.js";

/**
 * Coerce an arbitrary value into a plain object suitable for JSON
 * serialization. Strings, numbers, arrays, `null`, and `undefined`
 * become `{}` so the audit record's `payload` shape stays
 * predictable.
 */
export function normalizePayload(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return { ...(value as Record<string, unknown>) };
}

/**
 * Walk a structured value and prefix-redact any string field whose
 * key name smells like a credential (`api_key`, `token`, `secret`,
 * `password`). The runtime uses this before handing a payload to the
 * redaction engine so the engine's regex set only has to mop up
 * values that slipped past the structural pass.
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

/**
 * Run an envelope payload through the structural pre-redaction pass
 * and then through the supplied {@link RedactionEngine}. Returns the
 * redacted payload already parsed back into an object so the audit
 * recorder can append it without an extra round-trip.
 */
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
