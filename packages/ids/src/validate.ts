// ID validation — checks format, prefix, and body
import { type EntityType, REVERSE_PREFIX_MAP } from "./prefixes.js";

const BODY_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type ValidationResult =
	| { valid: true; entityType: EntityType }
	| { valid: false; reason: string };

export function validateId(raw: string): ValidationResult {
	if (!raw) {
		return { valid: false, reason: "Empty input" };
	}

	const sepIdx = raw.indexOf("_");
	if (sepIdx === -1) {
		return { valid: false, reason: "Missing separator" };
	}

	const prefix = raw.substring(0, sepIdx);
	const body = raw.substring(sepIdx + 1);

	const entityType = REVERSE_PREFIX_MAP[prefix];
	if (!entityType) {
		return { valid: false, reason: `Unknown prefix: ${prefix}` };
	}

	if (body.length !== 26) {
		return {
			valid: false,
			reason: `Invalid body length: expected 26, got ${body.length}`,
		};
	}

	if (!BODY_REGEX.test(body)) {
		return { valid: false, reason: "Invalid characters in body" };
	}

	return { valid: true, entityType };
}
