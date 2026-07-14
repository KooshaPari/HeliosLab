// ID parsing — extracts entity type, timestamp, and ULID body
import { type EntityType, REVERSE_PREFIX_MAP } from "./prefixes.js";
import { decodeTime } from "./ulid.js";
import { validateId } from "./validate.js";

export interface ParsedId {
	entityType: EntityType;
	timestamp: Date;
	ulid: string;
}

export function parseId(raw: string): ParsedId | null {
	const result = validateId(raw);
	if (!result.valid) {
		return null;
	}

	const sepIdx = raw.indexOf("_");
	const body = raw.substring(sepIdx + 1);

	const timeComponent = body.substring(0, 10);
	const timestamp = decodeTime(timeComponent);

	return {
		entityType: result.entityType,
		timestamp: new Date(timestamp),
		ulid: body,
	};
}
