#!/usr/bin/env bun
/**
 * Dependency status command: reports current pins, latest versions, and staleness.
 * Usage: bun run deps:status [--json]
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { DepsRegistry } from "./deps-types";

const REPO_ROOT = process.cwd();
const REGISTRY_PATH = join(REPO_ROOT, "deps-registry.json");
const CACHE_DIR = join(REPO_ROOT, ".cache");
const CACHE_FILE = join(CACHE_DIR, "deps-status-cache.json");

interface CachedVersion {
	package: string;
	latest: string;
	cachedAt: string;
}

interface StatusReport {
	package: string;
	currentPin: string;
	latestAvailable: string | null;
	channel: string;
	daysSinceUpdate: number;
	status: "up-to-date" | "upgrade-available" | "stale" | "error";
	error?: string;
}

/**
 * Calculate days since the given ISO timestamp.
 */
function daysSince(timestamp: string): number {
	const then = new Date(timestamp);
	const now = new Date();
	const ms = now.getTime() - then.getTime();
	return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Parse cache duration string (ISO 8601 duration) to milliseconds.
 * For simplicity, handles PT1H, PT30M, PT1D, etc.
 */
function parseDuration(duration: string): number {
	// Simple parser for common durations: PT1H, PT30M, PT1D, etc.
	const match = duration.match(/PT(\d+)([HMS])/);
	if (!match) return 3600000; // default 1 hour
	const [, value, unit] = match;
	const num = parseInt(value, 10);
	switch (unit) {
		case "H":
			return num * 3600000;
		case "M":
			return num * 60000;
		case "S":
			return num * 1000;
		default:
			return 3600000;
	}
}

/**
 * Check if cache is still fresh.
 */
function isCacheFresh(cacheFile: string, maxAge: number): boolean {
	if (!existsSync(cacheFile)) return false;
	const stat = require("fs").statSync(cacheFile);
	const ageMs = Date.now() - stat.mtimeMs;
	return ageMs < maxAge;
}

/**
 * Load cached versions if available and fresh.
 */
function loadCache(maxAge: number): Map<string, string> {
	const map = new Map<string, string>();
	if (!isCacheFresh(CACHE_FILE, maxAge)) return map;

	try {
		const data = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
		(data as CachedVersion[]).forEach((entry) => {
			map.set(entry.package, entry.latest);
		});
	} catch (e) {
		// Ignore cache read errors
	}
	return map;
}

/**
 * Save cache to disk.
 */
function saveCache(cached: Map<string, string>): void {
	try {
		if (!existsSync(CACHE_DIR)) {
			require("fs").mkdirSync(CACHE_DIR, { recursive: true });
		}
		const data: CachedVersion[] = Array.from(cached.entries()).map(
			([pkg, version]) => ({
				package: pkg,
				latest: version,
				cachedAt: new Date().toISOString(),
			}),
		);
		writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
	} catch (e) {
		// Ignore cache write errors
	}
}

/**
 * Query npm registry for latest version.
 */
async function queryNpmRegistry(pkg: string): Promise<string | null> {
	try {
		const response = await fetch(`https://registry.npmjs.org/${pkg}`);
		if (!response.ok) return null;
		const data = (await response.json()) as {
			"dist-tags"?: { latest: string };
		};
		return data["dist-tags"]?.latest || null;
	} catch (e) {
		return null;
	}
}

/**
 * Query GitHub releases API for latest version.
 */
async function queryGitHubReleases(apiUrl: string): Promise<string | null> {
	try {
		const response = await fetch(apiUrl);
		if (!response.ok) return null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const releases = (await response.json()) as any[];
		if (releases.length === 0) return null;
		// Get tag_name and remove 'v' prefix if present
		const tag = releases[0].tag_name || "";
		return tag.replace(/^v/, "");
	} catch (e) {
		return null;
	}
}

/**
 * Fetch latest version from upstream source.
 */
async function fetchLatestVersion(
	pkg: string,
	source: string,
): Promise<string | null> {
	if (source.includes("registry.npmjs.org")) {
		const pkgName = source.split("/").pop();
		return queryNpmRegistry(pkgName || pkg);
	} else if (
		source.includes("github.com") ||
		source.includes("api.github.com")
	) {
		return queryGitHubReleases(source);
	}
	return null;
}

/**
 * Generate status report for all dependencies.
 */
async function generateReport(jsonFormat: boolean): Promise<void> {
	// Read registry
	let registry: DepsRegistry;
	try {
		registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
	} catch (e) {
		console.error(`Error reading registry: ${e}`);
		process.exit(2);
	}

	const maxAgeMs = parseDuration(registry.metadata.registryCacheMaxAge);
	const cache = loadCache(maxAgeMs);
	const reports: StatusReport[] = [];

	// Process each dependency
	for (const dep of registry.dependencies) {
		let latest: string | null = cache.get(dep.name) || null;

		// If not in cache or cache is stale, try to fetch
		if (!cache.has(dep.name)) {
			latest = await fetchLatestVersion(dep.name, dep.upstreamSource);
			if (latest) {
				cache.set(dep.name, latest);
			}
		}

		const daysSince = daysSince(dep.lastUpdated);
		let status: "up-to-date" | "upgrade-available" | "stale" | "error";

		if (latest === null) {
			status = "error";
		} else if (latest === dep.currentPin) {
			status = "up-to-date";
		} else {
			status = "upgrade-available";
		}

		if (daysSince > 30) {
			status = "stale";
		}

		reports.push({
			package: dep.name,
			currentPin: dep.currentPin,
			latestAvailable: latest,
			channel: dep.channel,
			daysSinceUpdate: daysSince,
			status,
		});
	}

	// Save updated cache
	saveCache(cache);

	// Output
	if (jsonFormat) {
		console.log(JSON.stringify(reports, null, 2));
	} else {
		// Table format
		console.log("\nDependency Status Report");
		console.log("========================\n");

		const headers = [
			"Package",
			"Current",
			"Latest",
			"Channel",
			"Days Old",
			"Status",
		];
		const rows = reports.map((r) => [
			r.package,
			r.currentPin,
			r.latestAvailable || "unknown",
			r.channel,
			r.daysSinceUpdate.toString(),
			r.status,
		]);

		// Simple table rendering
		const colWidths = headers.map((h, i) =>
			Math.max(h.length, Math.max(...rows.map((r) => r[i].length))),
		);

		console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join(" │ "));
		console.log(colWidths.map((w) => "─".repeat(w)).join("─┼─"));

		rows.forEach((row) => {
			console.log(row.map((cell, i) => cell.padEnd(colWidths[i])).join(" │ "));
		});

		console.log();

		// Summary
		const upToDate = reports.filter((r) => r.status === "up-to-date").length;
		const upgradeable = reports.filter(
			(r) => r.status === "upgrade-available",
		).length;
		const stale = reports.filter((r) => r.status === "stale").length;
		const errors = reports.filter((r) => r.status === "error").length;

		console.log(
			`Summary: ${upToDate} up-to-date, ${upgradeable} upgradeable, ${stale} stale, ${errors} errors`,
		);
	}

	// Exit code based on status
	const hasUpgrades = reports.some((r) => r.status === "upgrade-available");
	const hasErrors = reports.some((r) => r.status === "error");

	if (hasErrors) {
		process.exit(2);
	} else if (hasUpgrades) {
		process.exit(1);
	} else {
		process.exit(0);
	}
}

// Main entry point
const args = process.argv.slice(2);
const jsonFormat = args.includes("--json");
generateReport(jsonFormat).catch((e) => {
	console.error(`Error: ${e}`);
	process.exit(2);
});
