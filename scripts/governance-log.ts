/**
 * Governance Log Utility Functions
 * Provides append-only logging and querying for merge governance records.
 */

import { promises as fs } from "fs";
import * as path from "path";
import type {
	GovernanceLogEntry,
	ValidationResult,
	GovernanceLogQueryResult,
} from "./governance-types";

const GOVERNANCE_LOG_PATH = path.join(
	path.dirname(path.dirname(import.meta.url)).replace("file://", ""),
	"governance-log.jsonl",
);

/**
 * Append a governance entry to the log.
 * Validates the entry against the schema before appending.
 * Uses atomic write (temp file + rename) to prevent corruption.
 */
export async function appendGovernanceEntry(
	entry: GovernanceLogEntry,
): Promise<void> {
	// Validate entry
	validateEntry(entry);

	const jsonLine = JSON.stringify(entry);
	const tempFile = `${GOVERNANCE_LOG_PATH}.tmp`;

	try {
		// Read existing log
		let content = "";
		try {
			content = await fs.readFile(GOVERNANCE_LOG_PATH, "utf-8");
		} catch {
			// File doesn't exist yet, that's ok
			content = "";
		}

		// Append new entry
		const newContent = content ? `${content}\n${jsonLine}\n` : `${jsonLine}\n`;

		// Write to temp file
		await fs.writeFile(tempFile, newContent, "utf-8");

		// Atomic rename
		await fs.rename(tempFile, GOVERNANCE_LOG_PATH);
	} catch (error) {
		// Clean up temp file
		try {
			await fs.unlink(tempFile);
		} catch {}
		throw error;
	}
}

/**
 * Validate a governance log entry against the schema.
 */
function validateEntry(entry: GovernanceLogEntry): void {
	const errors: string[] = [];

	if (!Number.isInteger(entry.prNumber) || entry.prNumber <= 0) {
		errors.push("prNumber must be a positive integer");
	}
	if (!entry.title || typeof entry.title !== "string") {
		errors.push("title must be a non-empty string");
	}
	if (!entry.author || typeof entry.author !== "string") {
		errors.push("author must be a non-empty string");
	}
	if (!Array.isArray(entry.reviewers)) {
		errors.push("reviewers must be an array");
	}
	if (!entry.gateResults || typeof entry.gateResults !== "object") {
		errors.push("gateResults must be an object");
	}
	if (
		!["qualityGates", "gcaReview", "coderabbitReview", "complianceCheck"].every(
			(key) =>
				typeof entry.gateResults[key as keyof typeof entry.gateResults] ===
				"boolean",
		)
	) {
		errors.push("all gateResults fields must be boolean");
	}
	if (typeof entry.complianceAttestation !== "boolean") {
		errors.push("complianceAttestation must be boolean");
	}
	if (!Array.isArray(entry.exceptionADRs)) {
		errors.push("exceptionADRs must be an array");
	}
	if (typeof entry.selfMerge !== "boolean") {
		errors.push("selfMerge must be boolean");
	}
	if (!entry.mergeCommitSha || !/^[a-f0-9]{40}$/.test(entry.mergeCommitSha)) {
		errors.push("mergeCommitSha must be a valid 40-char SHA");
	}
	if (!entry.timestamp || isNaN(Date.parse(entry.timestamp))) {
		errors.push("timestamp must be a valid ISO 8601 string");
	}

	if (errors.length > 0) {
		throw new Error(`Invalid governance entry: ${errors.join("; ")}`);
	}
}

/**
 * Get all self-merges in the past N days.
 */
export async function getSelfMerges(
	days: number,
): Promise<GovernanceLogQueryResult> {
	const entries = await readAllEntries();
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

	const filtered = entries.filter((entry) => {
		const entryDate = new Date(entry.timestamp);
		return entry.selfMerge && entryDate >= cutoff;
	});

	return { entries: filtered, count: filtered.length };
}

/**
 * Get all merges that used exception ADRs.
 */
export async function getExceptionADRs(): Promise<GovernanceLogQueryResult> {
	const entries = await readAllEntries();

	const filtered = entries.filter((entry) => entry.exceptionADRs.length > 0);

	return { entries: filtered, count: filtered.length };
}

/**
 * Get all merges by a specific author.
 */
export async function getEntriesByAuthor(
	author: string,
): Promise<GovernanceLogQueryResult> {
	const entries = await readAllEntries();

	const filtered = entries.filter((entry) => entry.author === author);

	return { entries: filtered, count: filtered.length };
}

/**
 * Get merges within a date range.
 */
export async function getEntriesInRange(
	from: Date,
	to: Date,
): Promise<GovernanceLogQueryResult> {
	const entries = await readAllEntries();

	const filtered = entries.filter((entry) => {
		const entryDate = new Date(entry.timestamp);
		return entryDate >= from && entryDate <= to;
	});

	return { entries: filtered, count: filtered.length };
}

/**
 * Validate the entire governance log.
 * Checks that all entries conform to the schema.
 */
export async function validateGovernanceLog(): Promise<ValidationResult> {
	try {
		const content = await fs.readFile(GOVERNANCE_LOG_PATH, "utf-8");
		const lines = content
			.trim()
			.split("\n")
			.filter((line) => line.length > 0);

		const invalidEntries: Array<{ line: number; error: string }> = [];

		for (let i = 0; i < lines.length; i++) {
			try {
				const entry = JSON.parse(lines[i]) as GovernanceLogEntry;
				validateEntry(entry);
			} catch (error) {
				invalidEntries.push({
					line: i + 1,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return {
			valid: invalidEntries.length === 0,
			totalEntries: lines.length,
			invalidEntries,
		};
	} catch (error) {
		return {
			valid: false,
			totalEntries: 0,
			invalidEntries: [
				{
					line: 0,
					error:
						error instanceof Error
							? error.message
							: "Failed to read governance log",
				},
			],
		};
	}
}

/**
 * Read all entries from the governance log.
 */
async function readAllEntries(): Promise<GovernanceLogEntry[]> {
	try {
		const content = await fs.readFile(GOVERNANCE_LOG_PATH, "utf-8");
		return content
			.trim()
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as GovernanceLogEntry);
	} catch {
		return [];
	}
}

/**
 * CLI entry point for governance log queries.
 * Usage: tsx scripts/governance-log.ts <command> [args]
 */
if (import.meta.main) {
	const args = process.argv.slice(2);
	const command = args[0];

	const run = async () => {
		switch (command) {
			case "validate":
				const result = await validateGovernanceLog();
				console.log(JSON.stringify(result, null, 2));
				process.exit(result.valid ? 0 : 1);
				break;

			case "self-merges":
				const days = parseInt(args[1] || "7", 10);
				const selfMerges = await getSelfMerges(days);
				console.log(`Self-merges in last ${days} days:`, selfMerges.count);
				selfMerges.entries.forEach((e) =>
					console.log(`  PR #${e.prNumber}: ${e.author}`),
				);
				break;

			case "exceptions":
				const exceptions = await getExceptionADRs();
				console.log(`Merges with exceptions: ${exceptions.count}`);
				exceptions.entries.forEach((e) => {
					console.log(`  PR #${e.prNumber}: ${e.exceptionADRs.join(", ")}`);
				});
				break;

			case "by-author":
				const author = args[1];
				if (!author) {
					console.error("Usage: governance-log.ts by-author <author>");
					process.exit(1);
				}
				const byAuthor = await getEntriesByAuthor(author);
				console.log(`Merges by ${author}: ${byAuthor.count}`);
				byAuthor.entries.forEach((e) =>
					console.log(`  PR #${e.prNumber}: ${e.title}`),
				);
				break;

			default:
				console.error(`Unknown command: ${command}`);
				console.error(
					"Available commands: validate, self-merges, exceptions, by-author",
				);
				process.exit(1);
		}
	};

	run().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
