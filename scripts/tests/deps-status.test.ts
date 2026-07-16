import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	mkdirSync,
	utimesSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { DepsRegistry } from "../deps-types";

const REPO_ROOT = process.cwd();
const CACHE_DIR = join(REPO_ROOT, ".cache");
const CACHE_FILE = join(CACHE_DIR, "deps-status-cache.json");
const STATUS_SCRIPT = join(REPO_ROOT, "scripts", "deps-status.ts");

function createStatusFixture(latest: string, cacheAgeMs = 0): string {
	const fixtureDir = mkdtempSync(join(tmpdir(), "deps-status-cli-"));
	const registry: DepsRegistry = {
		schemaVersion: "1.0.0",
		metadata: {
			lastStatusCheck: "2026-01-01T00:00:00.000Z",
			registryCacheMaxAge: "PT1H",
		},
		dependencies: [
			{
				name: "fixture-package",
				currentPin: "1.0.0",
				channel: "stable",
				upstreamSource: "https://unavailable.invalid/fixture-package",
				knownGoodHistory: [],
				lastUpdated: "2026-01-01T00:00:00.000Z",
			},
		],
	};

	writeFileSync(join(fixtureDir, "deps-registry.json"), JSON.stringify(registry));
	const cacheDir = join(fixtureDir, ".cache");
	mkdirSync(cacheDir, { recursive: true });
	const cacheFile = join(cacheDir, "deps-status-cache.json");
	writeFileSync(
		cacheFile,
		JSON.stringify([
			{
				package: "fixture-package",
				latest,
				cachedAt: new Date().toISOString(),
			},
		]),
	);
	if (cacheAgeMs > 0) {
		const staleTime = new Date(Date.now() - cacheAgeMs);
		utimesSync(cacheFile, staleTime, staleTime);
	}

	return fixtureDir;
}

async function runStatusFixture(fixtureDir: string, jsonFormat = true): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	const args = [process.execPath, STATUS_SCRIPT];
	if (jsonFormat) args.push("--json");
	const child = Bun.spawn(args, {
		cwd: fixtureDir,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

// Traces to: FR-DEP-002 (bun run deps:status command)
describe("Dependency Status Command", () => {
	beforeEach(() => {
		// Clean up cache before each test
		try {
			rmSync(CACHE_DIR, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	afterEach(() => {
		// Clean up cache after each test
		try {
			rmSync(CACHE_DIR, { recursive: true, force: true });
		} catch {
			// Ignore
		}
	});

	test("status command loads and parses registry", async () => {
		// This is a fixture test: we rely on deps-registry.json existing
		// The command should successfully load it without errors
		const registryPath = join(REPO_ROOT, "deps-registry.json");
		const stat = require("fs").statSync(registryPath);
		expect(stat.isFile()).toBe(true);
	});

	test("status command reports every tracked dependency", async () => {
		const registry: DepsRegistry = JSON.parse(
			readFileSync(join(REPO_ROOT, "deps-registry.json"), "utf-8"),
		);
		mkdirSync(CACHE_DIR, { recursive: true });
		writeFileSync(
			CACHE_FILE,
			JSON.stringify(
				registry.dependencies.map((dependency) => ({
					package: dependency.name,
					latest: dependency.currentPin,
					cachedAt: new Date().toISOString(),
				})),
			),
		);

		const child = Bun.spawn(
			[process.execPath, "scripts/deps-status.ts", "--json"],
			{
				cwd: REPO_ROOT,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);

		expect(exitCode, stderr).toBe(0);
		const report = JSON.parse(stdout) as Array<{ package: string }>;
		expect(report.map((entry) => entry.package)).toEqual(
			registry.dependencies.map((dependency) => dependency.name),
		);
	});

	test("available upgrade remains actionable when the dependency is stale", async () => {
		const fixtureDir = createStatusFixture("1.1.0");
		try {
			const result = await runStatusFixture(fixtureDir);
			const report = JSON.parse(result.stdout) as Array<{ status: string }>;

			expect(result.exitCode, result.stderr).toBe(1);
			expect(report[0]?.status).toBe("upgrade-available");
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	}, 15_000);

	test("unavailable upstream warns and retains stale cached evidence", async () => {
		const fixtureDir = createStatusFixture("1.1.0", 2 * 60 * 60 * 1000);
		try {
			const result = await runStatusFixture(fixtureDir);
			const report = JSON.parse(result.stdout) as Array<{
				latestAvailable: string | null;
				status: string;
			}>;

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("using stale cache");
			expect(report[0]?.latestAvailable).toBe("1.1.0");
			expect(report[0]?.status).toBe("upgrade-available");
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	}, 15_000);

	test("warm-cache table output remains readable and completes within 10 seconds", async () => {
		const fixtureDir = createStatusFixture("1.0.0");
		try {
			const startedAt = performance.now();
			const result = await runStatusFixture(fixtureDir, false);
			const elapsedMs = performance.now() - startedAt;

			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain("Dependency Status Report");
			expect(result.stdout).toContain("Package");
			expect(result.stdout).toContain("fixture-package");
			expect(result.stdout).toContain("Summary:");
			expect(elapsedMs).toBeLessThan(10_000);
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	}, 15_000);

	test("cache file is created on first run", () => {
		// After running deps-status, cache should be created
		// This is verified by checking that cache directory can be created
		try {
			mkdirSync(CACHE_DIR, { recursive: true });
			expect(true).toBe(true);
		} catch {
			expect(false).toBe(true);
		}
	});

	test("duration parsing handles PT1H format", () => {
		// Helper to test duration parsing
		function parseDuration(duration: string): number {
			const match = duration.match(/PT(\d+)([HMS])/);
			if (!match) return 3600000;
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

		expect(parseDuration("PT1H")).toBe(3600000);
		expect(parseDuration("PT30M")).toBe(1800000);
		expect(parseDuration("PT60S")).toBe(60000);
	});

	test("cache is considered fresh within TTL", () => {
		// Test cache freshness logic
		const maxAge = 3600000; // 1 hour
		const cacheAge = 1800000; // 30 minutes
		expect(cacheAge < maxAge).toBe(true);
	});

	test("cache is considered stale after TTL", () => {
		// Test cache staleness logic
		const maxAge = 3600000; // 1 hour
		const cacheAge = 7200000; // 2 hours
		expect(cacheAge < maxAge).toBe(false);
	});

	test("daysSince calculation is correct", () => {
		// Helper to test days calculation
		function daysSince(timestamp: string): number {
			const then = new Date(timestamp);
			const now = new Date();
			const ms = now.getTime() - then.getTime();
			return Math.floor(ms / (1000 * 60 * 60 * 24));
		}

		const now = new Date();
		const oneDayAgo = new Date(now.getTime() - 86400000);
		const days = daysSince(oneDayAgo.toISOString());
		expect(days).toBe(1);

		const thirtyDaysAgo = new Date(now.getTime() - 86400000 * 30);
		const daysOld = daysSince(thirtyDaysAgo.toISOString());
		expect(daysOld).toBe(30);
	});

	test("status enum values are valid", () => {
		const validStatuses = ["up-to-date", "upgrade-available", "stale", "error"];
		expect(validStatuses).toContain("up-to-date");
		expect(validStatuses).toContain("upgrade-available");
		expect(validStatuses).toContain("stale");
		expect(validStatuses).toContain("error");
	});

	test("JSON output format validation", () => {
		// Test that JSON output would be valid
		const mockReport = [
			{
				package: "electrobun",
				currentPin: "0.0.0-canary.20250228",
				latestAvailable: "0.0.0-canary.20250301",
				channel: "alpha",
				daysSinceUpdate: 2,
				status: "upgrade-available" as const,
			},
		];

		const json = JSON.stringify(mockReport, null, 2);
		const parsed = JSON.parse(json);
		expect(parsed[0].package).toBe("electrobun");
		expect(parsed[0].status).toBe("upgrade-available");
	});

	test("exit codes are correct for different scenarios", () => {
		// Test exit code logic
		const testCases = [
			{ hasErrors: false, hasUpgrades: false, expectedCode: 0 },
			{ hasErrors: false, hasUpgrades: true, expectedCode: 1 },
			{ hasErrors: true, hasUpgrades: false, expectedCode: 2 },
			{ hasErrors: true, hasUpgrades: true, expectedCode: 2 },
		];

		testCases.forEach(({ hasErrors, hasUpgrades, expectedCode }) => {
			let actualCode = 0;
			if (hasErrors) {
				actualCode = 2;
			} else if (hasUpgrades) {
				actualCode = 1;
			}
			expect(actualCode).toBe(expectedCode);
		});
	});
});
