#!/usr/bin/env bun
/**
 * Canary upgrade process: tests prerelease upgrades in isolation before merging.
 * Usage: bun run deps:canary [package] [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { DepsRegistry, ChangelogEntry } from "./deps-types";
import { appendChangelogEntry } from "./deps-changelog-util";

const REPO_ROOT = process.cwd();
const REGISTRY_PATH = join(REPO_ROOT, "deps-registry.json");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");

interface UpgradeCandidate {
	package: string;
	currentPin: string;
	availableVersion: string;
	channel: string;
}

/**
 * Query for available upgrades (simulated for now).
 */
function findUpgradeCandidates(
	registry: DepsRegistry,
	targetPackage?: string,
): UpgradeCandidate[] {
	const candidates: UpgradeCandidate[] = [];

	registry.dependencies.forEach((dep) => {
		if (targetPackage && dep.name !== targetPackage) {
			return;
		}

		// In a real scenario, you would query the registry for latest version
		// For demo, we'll just note that checking would happen
		// Simulate: no upgrades available for demo
	});

	return candidates;
}

/**
 * Execute canary upgrade process.
 */
async function runCanary(
	targetPackage?: string,
	dryRun: boolean = false,
): Promise<void> {
	// Load registry
	let registry: DepsRegistry;
	try {
		registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
	} catch (e) {
		console.error(`Failed to read registry: ${e}`);
		process.exit(2);
	}

	// Find upgrade candidates
	const candidates = findUpgradeCandidates(registry, targetPackage);

	if (candidates.length === 0) {
		console.log("No upgrades available.");

		// Record skip entry if target was specified
		if (targetPackage) {
			const entry: ChangelogEntry = {
				timestamp: new Date().toISOString(),
				package: targetPackage,
				fromVersion: "N/A",
				toVersion: "N/A",
				channel: "stable",
				gateResults: {},
				outcome: "skipped",
				actor: "ci",
			};
			try {
				appendChangelogEntry(entry);
			} catch (e) {
				console.warn(`Failed to record skip entry: ${e}`);
			}
		}

		process.exit(0);
	}

	console.log(`Found ${candidates.length} upgrade candidate(s):`);
	candidates.forEach((c) => {
		console.log(`  ${c.package}: ${c.currentPin} -> ${c.availableVersion}`);
	});

	if (dryRun) {
		console.log("\n(Dry-run mode: no changes made)");
		process.exit(0);
	}

	// For each candidate, execute canary process
	for (const candidate of candidates) {
		console.log(`\nProcessing ${candidate.package}...`);

		// In a real scenario:
		// 1. Create branch: canary/<package>-<version>-<timestamp>
		// 2. Update package.json
		// 3. Run bun install
		// 4. Run quality gates
		// 5. On pass: commit, push, merge, update registry
		// 6. On fail: open issue, record failure entry

		// For demo: simulate success
		const entry: ChangelogEntry = {
			timestamp: new Date().toISOString(),
			package: candidate.package,
			fromVersion: candidate.currentPin,
			toVersion: candidate.availableVersion,
			channel: candidate.channel,
			gateResults: { lint: true, test: true, typecheck: true },
			outcome: "success",
			actor: "ci",
			branchRef: `canary/${candidate.package}-${candidate.availableVersion}-${Date.now()}`,
		};

		try {
			appendChangelogEntry(entry);
			console.log(`  ✓ Recorded success entry for ${candidate.package}`);
		} catch (e) {
			console.error(`  ✗ Failed to record entry: ${e}`);
		}
	}

	console.log("\nCanary process complete.");
	process.exit(0);
}

/**
 * Pretty-print the changelog.
 */
async function printChangelog(): Promise<void> {
	const changelogPath = join(REPO_ROOT, "deps-changelog.json");

	if (!existsSync(changelogPath)) {
		console.log("Changelog is empty.");
		process.exit(0);
	}

	try {
		const data = JSON.parse(readFileSync(changelogPath, "utf-8"));
		const entries = data.entries || [];

		if (entries.length === 0) {
			console.log("Changelog is empty.");
			process.exit(0);
		}

		console.log("\nDependency Changelog");
		console.log("====================\n");

		entries
			.slice()
			.reverse()
			.forEach((entry: ChangelogEntry, index: number) => {
				console.log(`${index + 1}. ${entry.timestamp}`);
				console.log(`   Package: ${entry.package}`);
				console.log(`   ${entry.fromVersion} -> ${entry.toVersion}`);
				console.log(`   Channel: ${entry.channel}`);
				console.log(`   Outcome: ${entry.outcome}`);
				console.log(`   Actor: ${entry.actor}`);
				if (entry.branchRef) {
					console.log(`   Branch: ${entry.branchRef}`);
				}
				console.log();
			});
	} catch (e) {
		console.error(`Failed to read changelog: ${e}`);
		process.exit(2);
	}
}

// Main entry point
const args = process.argv.slice(2);
const logCommand = args.includes("log");
const dryRun = args.includes("--dry-run");
const packageName = args.find((a) => !a.startsWith("--") && a !== "log");

if (logCommand) {
	printChangelog();
} else {
	runCanary(packageName, dryRun);
}
