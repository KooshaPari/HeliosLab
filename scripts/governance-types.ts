/**
 * Governance Log Type Definitions
 * Defines the schema for append-only governance log entries.
 *
 * The governance log records every merge to main with full provenance,
 * enabling audit trails and compliance reporting.
 */

/**
 * Represents a single reviewer's decision on a PR.
 */
export interface ReviewerDecision {
	/** Name of the reviewer */
	name: string;
	/** Role of the reviewer (agent, human, bot) */
	role: "agent" | "human" | "bot";
	/** Review decision */
	decision: "approved" | "requested-changes" | "commented" | "dismissed";
}

/**
 * Results of all quality gates for a merge.
 */
export interface GateResults {
	/** Quality gates from spec 021 */
	qualityGates: boolean;
	/** GCA (GitHub Code Analysis) review result */
	gcaReview: boolean;
	/** CodeRabbit automated review result */
	coderabbitReview: boolean;
	/** Compliance checker from WP02 */
	complianceCheck: boolean;
}

/**
 * Single entry in the governance log.
 * Represents one merge to main with full context and provenance.
 */
export interface GovernanceLogEntry {
	/** GitHub PR number */
	prNumber: number;
	/** PR title */
	title: string;
	/** Author GitHub username */
	author: string;
	/** Array of reviewer decisions */
	reviewers: ReviewerDecision[];
	/** Results of all quality gates */
	gateResults: GateResults;
	/** Whether compliance attestation was obtained */
	complianceAttestation: boolean;
	/** References to Architecture Decision Records that granted exceptions (empty if none) */
	exceptionADRs: string[];
	/** Whether this was a self-merge (author merged own PR when all gates passed) */
	selfMerge: boolean;
	/** Full commit SHA of the merge commit */
	mergeCommitSha: string;
	/** ISO 8601 timestamp of the merge */
	timestamp: string;
}

/**
 * Query result for governance log entries.
 */
export interface GovernanceLogQueryResult {
	entries: GovernanceLogEntry[];
	count: number;
	error?: string;
}

/**
 * Validation result for governance log.
 */
export interface ValidationResult {
	valid: boolean;
	totalEntries: number;
	invalidEntries: Array<{
		line: number;
		error: string;
	}>;
}
