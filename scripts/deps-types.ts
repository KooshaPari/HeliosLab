/**
 * Type definitions for the dependency registry system.
 * These types ensure compile-time safety for manifest and changelog operations.
 */

/**
 * Represents a single version in the known-good history of a dependency.
 */
export interface KnownGoodVersion {
	/** Exact version string that was tested and verified as good */
	version: string;
	/** ISO 8601 timestamp when this version was verified */
	timestamp: string;
	/** Gate result summary: 'pass' | 'fail' - outcome of quality gates */
	gateResult: "pass" | "fail";
}

/**
 * Represents a single prerelease dependency in the registry.
 */
export interface DependencyEntry {
	/** Package identifier (e.g., 'electrobun', '@types/bun', 'ghostty') */
	name: string;
	/** Exact version string currently pinned in the project */
	currentPin: string;
	/** Release channel classification: 'alpha' | 'beta' | 'rc' | 'stable' */
	channel: "alpha" | "beta" | "rc" | "stable";
	/** URL to the upstream source (npm registry or GitHub releases API endpoint) */
	upstreamSource: string;
	/** Array of previously tested and verified versions, ordered chronologically (oldest first) */
	knownGoodHistory: KnownGoodVersion[];
	/** ISO 8601 timestamp of the last update check or upgrade attempt */
	lastUpdated: string;
}

/**
 * Metadata section of the registry tracking global state.
 */
export interface RegistryMetadata {
	/** ISO 8601 timestamp of the last status check operation */
	lastStatusCheck: string;
	/** Cache TTL duration as ISO 8601 duration (e.g., 'PT1H' for 1 hour) */
	registryCacheMaxAge: string;
}

/**
 * Root schema for deps-registry.json
 */
export interface DepsRegistry {
	/** Semantic version of the manifest schema for forward-compatible evolution */
	schemaVersion: string;
	/** Global metadata about the registry state */
	metadata: RegistryMetadata;
	/** Array of all tracked prerelease dependencies */
	dependencies: DependencyEntry[];
}

/**
 * Represents a single entry in the dependency upgrade changelog.
 */
export interface ChangelogEntry {
	/** ISO 8601 timestamp of the upgrade attempt */
	timestamp: string;
	/** Package name that was upgraded */
	package: string;
	/** Version being upgraded from */
	fromVersion: string;
	/** Version being upgraded to */
	toVersion: string;
	/** Release channel of the target version */
	channel: "alpha" | "beta" | "rc" | "stable";
	/** Per-gate pass/fail results (keys are gate names, values are boolean) */
	gateResults: Record<string, boolean>;
	/** Overall outcome of the upgrade attempt */
	outcome: "success" | "failure" | "rollback";
	/** Actor that initiated the upgrade: 'user' | 'ci' | 'canary' */
	actor: "user" | "ci" | "canary";
	/** Optional branch reference for canary or experimental runs */
	branchRef?: string;
}

/**
 * Root schema for deps-changelog.json
 */
export interface DepsChangelog {
	/** Array of upgrade attempts in chronological order */
	entries: ChangelogEntry[];
}
