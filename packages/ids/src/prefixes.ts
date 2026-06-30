// Prefix registry — maps entity types to canonical prefixes
// All prefixes are 2-3 lowercase alpha characters, unique, and frozen.

export type EntityType =
	| "workspace"
	| "lane"
	| "session"
	| "terminal"
	| "run"
	| "correlation";

export const PREFIX_MAP: Readonly<Record<EntityType, string>> = Object.freeze({
	workspace: "ws",
	lane: "ln",
	session: "ss",
	terminal: "tm",
	run: "rn",
	correlation: "cor",
});

export const REVERSE_PREFIX_MAP: Readonly<Record<string, EntityType>> =
	Object.freeze(
		Object.fromEntries(
			Object.entries(PREFIX_MAP).map(([entity, prefix]) => [
				prefix,
				entity as EntityType,
			]),
		) as Record<string, EntityType>,
	);

export function getPrefix(entityType: EntityType): string {
	return PREFIX_MAP[entityType];
}

export function getEntityType(prefix: string): EntityType | undefined {
	return REVERSE_PREFIX_MAP[prefix];
}
