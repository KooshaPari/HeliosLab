/**
 * Utility for appending entries to the dependency changelog.
 * Handles validation, atomic writes, and schema enforcement.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { DepsChangelog, ChangelogEntry } from "./deps-types";

const REPO_ROOT = process.cwd();
const CHANGELOG_PATH = join(REPO_ROOT, "deps-changelog.json");

/**
 * Validate a changelog entry against the schema.
 * Throws an error if validation fails.
 */
export function validateChangelogEntry(entry: ChangelogEntry): void {
	if (!entry.timestamp || !/^\d{4}-\d{2}-\d{2}T/.test(entry.timestamp)) {
		throw new Error("Invalid or missing timestamp field");
	}
	if (!entry.package || typeof entry.package !== "string") {
		throw new Error("Invalid or missing package field");
	}
	if (!entry.fromVersion || typeof entry.fromVersion !== "string") {
		throw new Error("Invalid or missing fromVersion field");
	}
	if (!entry.toVersion || typeof entry.toVersion !== "string") {
		throw new Error("Invalid or missing toVersion field");
	}
	if (!["alpha", "beta", "rc", "stable"].includes(entry.channel)) {
		throw new Error(`Invalid channel: ${entry.channel}`);
	}
	if (typeof entry.gateResults !== "object" || entry.gateResults === null) {
		throw new Error("Invalid or missing gateResults field");
	}
	if (!["success", "failure", "rollback"].includes(entry.outcome)) {
		throw new Error(`Invalid outcome: ${entry.outcome}`);
	}
	if (!["user", "ci", "canary"].includes(entry.actor)) {
		throw new Error(`Invalid actor: ${entry.actor}`);
	}
	if (entry.branchRef && typeof entry.branchRef !== "string") {
		throw new Error("Invalid branchRef field (must be string or undefined)");
	}
}

/**
 * Load the current changelog, or initialize empty if it doesn't exist.
 */
export function loadChangelog(): DepsChangelog {
	if (!existsSync(CHANGELOG_PATH)) {
		return { entries: [] };
	}

	try {
		const data = JSON.parse(readFileSync(CHANGELOG_PATH, "utf-8"));
		if (!Array.isArray(data.entries)) {
			throw new Error("Changelog entries is not an array");
		}
		return data as DepsChangelog;
	} catch (e) {
		throw new Error(`Failed to load changelog: ${e}`);
	}
}

/**
 * Append a validated entry to the changelog using atomic write.
 * Throws an error if validation fails or write fails.
 */
export function appendChangelogEntry(entry: ChangelogEntry): void {
	// Validate entry
	validateChangelogEntry(entry);

	// Load current changelog
	const changelog = loadChangelog();

	// Append new entry
	changelog.entries.push(entry);

	// Write to temporary file, then atomically rename
	const tempFile = join(tmpdir(), `changelog-${Date.now()}.tmp.json`);
	try {
		writeFileSync(tempFile, JSON.stringify(changelog, null, 2));
		// Atomic rename (move temp file to final location)
		require("fs").renameSync(tempFile, CHANGELOG_PATH);
	} catch (e) {
		// Clean up temp file if it exists
		if (existsSync(tempFile)) {
			try {
				require("fs").unlinkSync(tempFile);
			} catch (unlinkErr) {
				// Ignore cleanup errors
			}
		}
		throw new Error(`Failed to write changelog: ${e}`);
	}
}
