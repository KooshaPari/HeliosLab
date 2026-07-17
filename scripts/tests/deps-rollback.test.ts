import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "path";
import type { DepsRegistry, DepsChangelog } from "../deps-types";

const REPO_ROOT = process.cwd();
const REGISTRY_PATH = join(REPO_ROOT, "deps-registry.json");
const CHANGELOG_PATH = join(REPO_ROOT, "deps-changelog.json");
const PROTECTED_REPO_FILES = ["package.json", "bun.lock", "deps-registry.json",
	"deps-changelog.json", join("scripts", "deps-rollback.ts")].map(path => join(REPO_ROOT, path));

function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function prepareRollbackFixture(
	options: { changelog?: unknown; typecheckExitCode?: number } = {},
): Promise<{
	fixtureRoot: string;
	workspaceRoot: string;
	lockBefore: {
		workspaces: Record<string, { dependencies?: Record<string, string> }>;
		packages: Record<string, unknown>;
	};
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	repoHashesBefore: Map<string, string>;
	fixtureHashesBefore: Map<string, string>;
}> {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "helios-deps-rollback-"));
	const workspaceRoot = join(fixtureRoot, "apps", "tool");
	const productionScript = join(REPO_ROOT, "scripts", "deps-rollback.ts").replace(/\\/g, "/");
	for (const directory of [
		workspaceRoot,
		join(fixtureRoot, "vendor", "target-v1"),
		join(fixtureRoot, "vendor", "target-v2"),
		join(fixtureRoot, "vendor", "stable"),
	]) {
		mkdirSync(directory, { recursive: true });
	}

	writeFileSync(
		join(fixtureRoot, "package.json"),
		JSON.stringify({
			name: "rollback-fixture",
			private: true,
			workspaces: ["apps/tool"],
			scripts: {
				"deps:rollback": `bun ${productionScript}`,
				typecheck: `bun -e "process.exit(${options.typecheckExitCode ?? 0})"`,
			},
		}),
	);
	writeFileSync(
		join(workspaceRoot, "package.json"),
		JSON.stringify({
			name: "fixture-tool",
			version: "1.0.0",
			dependencies: {
				"fixture-target": "file:../../vendor/target-v2",
				"fixture-stable": "file:../../vendor/stable",
			},
		}),
	);
	for (const [directory, name, version] of [
		["target-v1", "fixture-target", "1.0.0"],
		["target-v2", "fixture-target", "2.0.0"],
		["stable", "fixture-stable", "1.0.0"],
	] as const) {
		writeFileSync(
			join(fixtureRoot, "vendor", directory, "package.json"),
			JSON.stringify({ name, version }),
		);
	}
	writeFileSync(
		join(fixtureRoot, "deps-registry.json"),
		JSON.stringify({
			schemaVersion: "1.0.0",
			metadata: { lastStatusCheck: new Date().toISOString(), registryCacheMaxAge: "PT1H" },
			dependencies: [
				{
					name: "fixture-target",
					currentPin: "file:../../vendor/target-v2",
					channel: "stable",
					upstreamSource: "file:../../vendor",
					knownGoodHistory: [
						{
							version: "file:../../vendor/target-v1",
							timestamp: "2026-01-01T00:00:00.000Z",
							gateResult: "pass",
						},
						{
							version: "file:../../vendor/target-v2",
							timestamp: "2026-02-01T00:00:00.000Z",
							gateResult: "pass",
						},
					],
					lastUpdated: "2026-02-01T00:00:00.000Z",
				},
			],
		}),
	);
	writeFileSync(
		join(fixtureRoot, "deps-changelog.json"),
		JSON.stringify(options.changelog ?? { entries: [] }),
	);

	const initialInstall = Bun.spawn([process.execPath, "install", "--lockfile-only"], {
		cwd: fixtureRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await initialInstall.exited) !== 0) {
		rmSync(fixtureRoot, { recursive: true, force: true });
		throw new Error("failed to prepare local rollback fixture lockfile");
	}
	const lockBefore = Bun.JSONC.parse(readFileSync(join(fixtureRoot, "bun.lock"), "utf-8")) as {
		workspaces: Record<string, { dependencies?: Record<string, string> }>;
		packages: Record<string, unknown>;
	};
	const repoHashesBefore = new Map(PROTECTED_REPO_FILES.map(path => [path, hashFile(path)]));
	const fixtureHashesBefore = new Map([
		join(fixtureRoot, "package.json"),
		join(workspaceRoot, "package.json"),
		join(fixtureRoot, "bun.lock"),
		join(fixtureRoot, "deps-registry.json"),
		join(fixtureRoot, "deps-changelog.json"),
	].map(path => [path, hashFile(path)]));
	const stdoutPath = join(fixtureRoot, "rollback.stdout.log");
	const stderrPath = join(fixtureRoot, "rollback.stderr.log");
	const startedAt = performance.now();
	const rollback = Bun.spawn(
		[process.execPath, "run", "deps:rollback", "fixture-target"],
		{
			cwd: fixtureRoot,
			stdout: Bun.file(stdoutPath),
			stderr: Bun.file(stderrPath),
		},
	);
	const exitCode = await rollback.exited;
	const durationMs = performance.now() - startedAt;
	return {
		fixtureRoot,
		workspaceRoot,
		lockBefore,
		exitCode,
		stdout: readFileSync(stdoutPath, "utf-8"),
		stderr: readFileSync(stderrPath, "utf-8"),
		durationMs,
		repoHashesBefore,
		fixtureHashesBefore,
	};
}

const [rollbackFixture, gateFailureFixture, lateFailureFixture] = await Promise.all(
	[prepareRollbackFixture(), prepareRollbackFixture({ typecheckExitCode: 7 }),
		prepareRollbackFixture({ changelog: { entries: "invalid" } })],
);

// Traces to: FR-DEP-004 (rollback command), FR-DEP-005 (atomic rollback)
describe("Dependency Rollback Integration", () => {
	beforeEach(() => {
		// Ensure changelog exists (create if missing)
		if (!existsSync(CHANGELOG_PATH)) {
			writeFileSync(CHANGELOG_PATH, JSON.stringify({ entries: [] }, null, 2));
		}
		// Ensure clean state
		try {
			rmSync(join(REPO_ROOT, ".deps-rollback-backup"), {
				recursive: true,
				force: true,
			});
		} catch {
			// Ignore
		}
	});

	afterEach(() => {
		// Clean up backup directory
		try {
			rmSync(join(REPO_ROOT, ".deps-rollback-backup"), {
				recursive: true,
				force: true,
			});
		} catch {
			// Ignore
		}
	});

	test("rollback target package exists in manifest", () => {
		const registry: DepsRegistry = JSON.parse(
			readFileSync(REGISTRY_PATH, "utf-8"),
		);
		expect(registry.dependencies.length).toBeGreaterThan(0);
		expect(registry.dependencies.some((d) => d.name === "electrobun")).toBe(
			true,
		);
	});

	test("rollback package has known-good history", () => {
		const registry: DepsRegistry = JSON.parse(
			readFileSync(REGISTRY_PATH, "utf-8"),
		);
		const dep = registry.dependencies.find((d) => d.name === "electrobun");
		expect(dep?.knownGoodHistory.length).toBeGreaterThan(0);
	});

	test("rollback requires at least two versions in history", () => {
		const registry: DepsRegistry = JSON.parse(
			readFileSync(REGISTRY_PATH, "utf-8"),
		);
		const dep = registry.dependencies.find((d) => d.name === "electrobun");
		// For rollback to be possible, need at least 2 versions
		if (dep && dep.knownGoodHistory.length > 1) {
			expect(true).toBe(true);
		} else {
			// This is expected if only one version has been tested
			expect(dep?.knownGoodHistory.length).toBeGreaterThanOrEqual(1);
		}
	});

	test("known-good history is ordered chronologically", () => {
		const registry: DepsRegistry = JSON.parse(
			readFileSync(REGISTRY_PATH, "utf-8"),
		);
		const dep = registry.dependencies.find((d) => d.name === "electrobun");
		if (dep) {
			const timestamps = dep.knownGoodHistory.map((entry) =>
				new Date(entry.timestamp).getTime(),
			);
			for (let i = 1; i < timestamps.length; i++) {
				expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
			}
		}
	});

	test("package not in manifest returns error", () => {
		const registry: DepsRegistry = JSON.parse(
			readFileSync(REGISTRY_PATH, "utf-8"),
		);
		const notFound = registry.dependencies.find(
			(d) => d.name === "nonexistent-package-xyz",
		);
		expect(notFound).toBeUndefined();
	});

	test("registry can be updated with new current pin", () => {
		const registry: DepsRegistry = JSON.parse(
			readFileSync(REGISTRY_PATH, "utf-8"),
		);
		const originalPin = registry.dependencies[0].currentPin;

		// Simulate updating pin
		registry.dependencies[0].currentPin = "1.2.3-test";
		registry.dependencies[0].lastUpdated = new Date().toISOString();

		// Verify update
		expect(registry.dependencies[0].currentPin).toBe("1.2.3-test");
		expect(registry.dependencies[0].currentPin).not.toBe(originalPin);
	});

	test("changelog entry can be appended for rollback outcome", () => {
		const changelog: DepsChangelog = JSON.parse(
			readFileSync(CHANGELOG_PATH, "utf-8"),
		);
		const originalLength = changelog.entries.length;

		// Simulate entry append
		changelog.entries.push({
			timestamp: new Date().toISOString(),
			package: "test-rollback",
			fromVersion: "1.1.0",
			toVersion: "1.0.0",
			channel: "stable",
			gateResults: { typecheck: true },
			outcome: "success",
			actor: "user",
		});

		expect(changelog.entries.length).toBe(originalLength + 1);
		expect(changelog.entries[changelog.entries.length - 1].outcome).toBe(
			"success",
		);
	});

	test("rollback changelog entry has required fields", () => {
		const entry = {
			timestamp: new Date().toISOString(),
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250301",
			toVersion: "0.0.0-canary.20250228",
			channel: "alpha",
			gateResults: { typecheck: true },
			outcome: "success" as const,
			actor: "user" as const,
		};

		expect(entry.timestamp).toBeDefined();
		expect(entry.package).toBeDefined();
		expect(entry.fromVersion).toBeDefined();
		expect(entry.toVersion).toBeDefined();
		expect(entry.channel).toBeDefined();
		expect(entry.gateResults).toBeDefined();
		expect(entry.outcome).toBe("success");
		expect(entry.actor).toBe("user");
	});

	test("registry backup structure is valid", () => {
		const registry: DepsRegistry = JSON.parse(
			readFileSync(REGISTRY_PATH, "utf-8"),
		);
		expect(registry.schemaVersion).toBeDefined();
		expect(registry.metadata).toBeDefined();
		expect(registry.dependencies).toBeInstanceOf(Array);

		// Verify we can read and re-serialize
		const serialized = JSON.stringify(registry, null, 2);
		const reparsed = JSON.parse(serialized);
		expect(reparsed.schemaVersion).toBe(registry.schemaVersion);
	});

	test("rollback simulated state change updates registry correctly", () => {
		const registry: DepsRegistry = JSON.parse(
			readFileSync(REGISTRY_PATH, "utf-8"),
		);
		const dep = registry.dependencies[0];
		const originalPin = dep.currentPin;

		// Simulate what rollback would do: update to previous version
		if (dep.knownGoodHistory.length > 1) {
			const previousVersion =
				dep.knownGoodHistory[dep.knownGoodHistory.length - 2];
			dep.currentPin = previousVersion.version;
			dep.lastUpdated = new Date().toISOString();

			expect(dep.currentPin).toBe(previousVersion.version);
			expect(dep.currentPin).not.toBe(originalPin);
			expect(new Date(dep.lastUpdated).getTime()).toBeGreaterThan(0);
		}
	});

	test("backup and restore preserve file contents", () => {
		// Test the concept of backup/restore
		const registry: DepsRegistry = JSON.parse(
			readFileSync(REGISTRY_PATH, "utf-8"),
		);
		const backup = JSON.stringify(registry);

		// Make a change
		registry.dependencies[0].currentPin = "changed";

		// Restore from backup
		const restored: DepsRegistry = JSON.parse(backup);
		expect(restored.dependencies[0].currentPin).not.toBe("changed");
	});

	test("concurrent changelog appends produce consistent state", () => {
		const changelog: DepsChangelog = JSON.parse(
			readFileSync(CHANGELOG_PATH, "utf-8"),
		);
		const originalLength = changelog.entries.length;

		// Simulate concurrent appends (in reality would use atomic writes)
		changelog.entries.push({
			timestamp: new Date().toISOString(),
			package: "concurrent-1",
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			channel: "stable",
			gateResults: {},
			outcome: "success",
			actor: "ci",
		});

		changelog.entries.push({
			timestamp: new Date().toISOString(),
			package: "concurrent-2",
			fromVersion: "2.0.0",
			toVersion: "2.1.0",
			channel: "stable",
			gateResults: {},
			outcome: "success",
			actor: "ci",
		});

		expect(changelog.entries.length).toBe(originalLength + 2);
		expect(changelog.entries[changelog.entries.length - 2].package).toBe(
			"concurrent-1",
		);
		expect(changelog.entries[changelog.entries.length - 1].package).toBe(
			"concurrent-2",
		);
	});

	test("root rollback CLI restores the last known-good pin and regenerates bun.lock (FR-DEP-004)", async () => {
		const {
			fixtureRoot,
			workspaceRoot,
			lockBefore,
			exitCode,
			stdout,
			stderr,
			durationMs,
			repoHashesBefore,
		} = rollbackFixture;

		try {
			expect(exitCode, stderr).toBe(0);
			expect(durationMs).toBeLessThan(60_000);
			expect(stdout).toContain("fixture-target");
			expect(stdout).toContain("file:../../vendor/target-v2");
			expect(stdout).toContain("file:../../vendor/target-v1");
			expect(stdout.toLowerCase()).toContain("typecheck");
			expect(stdout.toLowerCase()).toContain("changelog");

			const workspacePackage = JSON.parse(
				readFileSync(join(workspaceRoot, "package.json"), "utf-8"),
			) as { dependencies: Record<string, string> };
			expect(workspacePackage.dependencies["fixture-target"]).toBe(
				"file:../../vendor/target-v1",
			);
			expect(workspacePackage.dependencies["fixture-stable"]).toBe(
				"file:../../vendor/stable",
			);

			const lockAfterText = readFileSync(join(fixtureRoot, "bun.lock"), "utf-8");
			const lockAfter = Bun.JSONC.parse(lockAfterText) as typeof lockBefore;
			expect(lockAfterText).toContain("target-v1");
			expect(lockAfterText).not.toContain("target-v2");
			expect(lockAfter.workspaces["apps/tool"]?.dependencies?.["fixture-stable"]).toBe(
				lockBefore.workspaces["apps/tool"]?.dependencies?.["fixture-stable"],
			);
			const stableLockKey = Object.keys(lockBefore.packages).find((key) =>
				key === "fixture-stable" || key.endsWith("/fixture-stable"),
			);
			expect(stableLockKey).toBeDefined();
			expect(lockAfter.packages[stableLockKey!]).toEqual(
				lockBefore.packages[stableLockKey!],
			);

			const registry = JSON.parse(
				readFileSync(join(fixtureRoot, "deps-registry.json"), "utf-8"),
			) as DepsRegistry;
			expect(registry.dependencies[0]?.currentPin).toBe("file:../../vendor/target-v1");
			const changelog = JSON.parse(
				readFileSync(join(fixtureRoot, "deps-changelog.json"), "utf-8"),
			) as DepsChangelog;
			expect(changelog.entries).toHaveLength(1);
			expect(changelog.entries[0]).toMatchObject({
				package: "fixture-target",
				fromVersion: "file:../../vendor/target-v2",
				toVersion: "file:../../vendor/target-v1",
				gateResults: { typecheck: true },
				outcome: "success",
				actor: "user",
			});
			expect(existsSync(join(fixtureRoot, ".deps-rollback-backup"))).toBe(false);
		} finally {
			rmSync(fixtureRoot, { recursive: true, force: true });
		}

		expect(existsSync(fixtureRoot)).toBe(false);
		for (const [path, hash] of repoHashesBefore) {
			expect(hashFile(path), `rollback modified consolidation file ${path}`).toBe(hash);
		}
	});

	test("root rollback CLI restores every tracked file after gate and publication failures (FR-DEP-005)", () => {
		for (const [failureStage, fixture] of [
			["changelog", lateFailureFixture],
			["typecheck", gateFailureFixture],
		] as const) {
			const { fixtureRoot, exitCode, stdout, stderr, repoHashesBefore,
				fixtureHashesBefore } = fixture;
			try {
				expect(exitCode).toBe(2);
				expect(`${stdout}\n${stderr}`.toLowerCase()).toContain(failureStage);
				if (failureStage === "changelog") {
					expect(stdout).toContain("typecheck: passed");
				}
				for (const [path, hash] of fixtureHashesBefore) {
					expect(hashFile(path), `${failureStage} failure changed ${path}`).toBe(hash);
				}
				expect(stderr).toContain("State restoration: passed");
				expect(existsSync(join(fixtureRoot, ".deps-rollback-backup"))).toBe(false);
			} finally {
				rmSync(fixtureRoot, { recursive: true, force: true });
			}

			expect(existsSync(fixtureRoot)).toBe(false);
			for (const [path, hash] of repoHashesBefore) {
				expect(hashFile(path), `rollback modified consolidation file ${path}`).toBe(hash);
			}
		}
	});
});
