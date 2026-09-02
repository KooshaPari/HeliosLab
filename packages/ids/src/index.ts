// Public API for @helios/ids
import {
	type EntityType,
	getPrefix,
	PREFIX_MAP,
	REVERSE_PREFIX_MAP,
} from "./prefixes.js";
import { generateUlid } from "./ulid.js";
import { validateId } from "./validate.js";
import { parseId } from "./parse.js";

export type { EntityType } from "./prefixes.js";
export type { ValidationResult } from "./validate.js";
export type { ParsedId } from "./parse.js";
export { validateId } from "./validate.js";
export { parseId } from "./parse.js";
export {
	getPrefix,
	getEntityType,
	PREFIX_MAP,
	REVERSE_PREFIX_MAP,
} from "./prefixes.js";

const ID_FORMAT_REGEX = /^[a-z]{2,3}_[0-9A-HJKMNP-TV-Z]{26}$/;

export function generateId(entityType: EntityType): string {
	const prefix = getPrefix(entityType);
	const ulid = generateUlid();
	const id = `${prefix}_${ulid}`;

	// Debug assertion (not in hot path — regex test is negligible)
	if (!ID_FORMAT_REGEX.test(id)) {
		throw new Error(`Generated ID does not match expected format: ${id}`);
	}

	return id;
}

export function generateCorrelationId(): string {
	return generateId("correlation");
}
