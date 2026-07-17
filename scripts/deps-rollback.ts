#!/usr/bin/env bun
/**
 * Revert a dependency to its most recent different known-good pin.
 * Usage: bun run deps:rollback <package>
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "fs";
import { join } from "path";
import type { ChangelogEntry, DepsRegistry } from "./deps-types";
import { appendChangelogEntry } from "./deps-changelog-util";

const REPO_ROOT = process.cwd();
const REGISTRY_PATH = join(REPO_ROOT, "deps-registry.json");
const CHANGELOG_PATH = join(REPO_ROOT, "deps-changelog.json");
const LOCKFILE_PATH = join(REPO_ROOT, "bun.lock");
const ROOT_MANIFEST_PATH = join(REPO_ROOT, "package.json");
const BACKUP_DIR = join(REPO_ROOT, ".deps-rollback-backup");

interface PackageManifest {
	workspaces?: string[] | { packages?: string[] };
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

interface TargetManifest {
	path: string;
	manifest: PackageManifest;
	section: "dependencies" | "devDependencies" | "optionalDependencies";
}

interface FileSnapshot {
	sourcePath: string;
	backupPath?: string;
	existed: boolean;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function readLock(): unknown {
	return Bun.JSONC.parse(readFileSync(LOCKFILE_PATH, "utf-8"));
}

function workspacePatterns(manifest: PackageManifest): string[] {
	if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
	return manifest.workspaces?.packages ?? [];
}

function expandWorkspacePattern(pattern: string): string[] {
	const normalized = pattern.replace(/\\/g, "/").replace(/\/$/, "");
	if (!normalized.endsWith("/*")) return [normalized];

	const parent = normalized.slice(0, -2);
	const parentPath = join(REPO_ROOT, parent);
	if (!existsSync(parentPath)) return [];
	return readdirSync(parentPath, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `${parent}/${entry.name}`);
}

function findTargetManifest(packageName: string): TargetManifest {
	const rootManifest = readJson<PackageManifest>(ROOT_MANIFEST_PATH);
	const manifestPaths = [
		ROOT_MANIFEST_PATH,
		...workspacePatterns(rootManifest)
			.flatMap(expandWorkspacePattern)
			.map((workspace) => join(REPO_ROOT, workspace, "package.json"))
			.filter(existsSync),
	];
	const matches: TargetManifest[] = [];

	for (const path of manifestPaths) {
		const manifest = path === ROOT_MANIFEST_PATH
			? rootManifest
			: readJson<PackageManifest>(path);
		for (const section of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
		] as const) {
			if (manifest[section]?.[packageName] !== undefined) {
				matches.push({ path, manifest, section });
			}
		}
	}

	if (matches.length === 0) {
		throw new Error(`Package '${packageName}' not found in root or declared workspace manifests`);
	}
	if (matches.length > 1) {
		throw new Error(`Package '${packageName}' is declared in multiple manifests`);
	}
	return matches[0];
}

function createBackup(manifestPath: string): FileSnapshot[] {
	const sourcePaths = [...new Set([
		manifestPath,
		LOCKFILE_PATH,
		REGISTRY_PATH,
		CHANGELOG_PATH,
	])];
	const snapshots: FileSnapshot[] = [];
	try {
		mkdirSync(BACKUP_DIR);
		for (const [index, sourcePath] of sourcePaths.entries()) {
			const existed = existsSync(sourcePath);
			const backupPath = existed ? join(BACKUP_DIR, `${index}.snapshot`) : undefined;
			if (backupPath) copyFileSync(sourcePath, backupPath);
			snapshots.push({ sourcePath, backupPath, existed });
		}
		return snapshots;
	} catch (error) {
		rmSync(BACKUP_DIR, { recursive: true, force: true });
		throw new Error(`Failed to snapshot rollback state: ${error}`);
	}
}

function restoreBackup(snapshots: FileSnapshot[]): void {
	const failures: string[] = [];
	for (const snapshot of snapshots) {
		try {
			if (snapshot.existed && snapshot.backupPath) {
				copyFileSync(snapshot.backupPath, snapshot.sourcePath);
			} else {
				rmSync(snapshot.sourcePath, { force: true });
			}
		} catch (error) {
			failures.push(`${snapshot.sourcePath}: ${error}`);
		}
	}
	if (failures.length > 0) {
		throw new Error(failures.join("; "));
	}
}

function runGate(label: string, args: string[]): void {
	const result = Bun.spawnSync(args, {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		throw new Error(`${label} failed (exit ${result.exitCode})\n${stderr || stdout}`);
	}
	console.log(`${label}: passed`);
}

function stripTargetFromLock(lock: unknown, packageName: string): unknown {
	const copy = structuredClone(lock) as {
		workspaces?: Record<string, Record<string, Record<string, unknown>>>;
		packages?: Record<string, unknown>;
	};
	for (const workspace of Object.values(copy.workspaces ?? {})) {
		for (const section of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
			"peerDependencies",
		]) {
			delete workspace[section]?.[packageName];
		}
	}
	for (const key of Object.keys(copy.packages ?? {})) {
		if (key === packageName || key.endsWith(`/${packageName}`)) {
			delete copy.packages?.[key];
		}
	}
	return copy;
}

function assertOnlyTargetLockChanged(before: unknown, after: unknown, packageName: string): void {
	const unrelatedBefore = JSON.stringify(stripTargetFromLock(before, packageName));
	const unrelatedAfter = JSON.stringify(stripTargetFromLock(after, packageName));
	if (unrelatedBefore !== unrelatedAfter) {
		throw new Error(`bun.lock contains changes unrelated to '${packageName}'`);
	}
}

async function rollback(packageName: string): Promise<void> {
	const startedAt = performance.now();
	const registry = readJson<DepsRegistry>(REGISTRY_PATH);
	const dependency = registry.dependencies.find((candidate) => candidate.name === packageName);
	if (!dependency) throw new Error(`Package '${packageName}' not found in registry`);

	const fromVersion = dependency.currentPin;
	const rollbackVersion = [...dependency.knownGoodHistory]
		.reverse()
		.find((candidate) => candidate.version !== fromVersion)?.version;
	if (!rollbackVersion) {
		throw new Error(`No previous known-good version available for '${packageName}'`);
	}

	const target = findTargetManifest(packageName);
	const lockBefore = readLock();
	const backup = createBackup(target.path);
	console.log(`Rolling back ${packageName}: ${fromVersion} -> ${rollbackVersion}`);

	try {
		target.manifest[target.section]![packageName] = rollbackVersion;
		writeFileSync(target.path, `${JSON.stringify(target.manifest, null, 2)}\n`);

		runGate("bun install --offline", [process.execPath, "install", "--offline"]);
		const lockAfter = readLock();
		assertOnlyTargetLockChanged(lockBefore, lockAfter, packageName);
		console.log("lockfile invariant: passed");
		runGate("typecheck", [process.execPath, "run", "typecheck"]);

		const timestamp = new Date().toISOString();
		dependency.currentPin = rollbackVersion;
		dependency.lastUpdated = timestamp;
		writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

		const entry: ChangelogEntry = {
			timestamp,
			package: packageName,
			fromVersion,
			toVersion: rollbackVersion,
			channel: dependency.channel,
			gateResults: { typecheck: true },
			outcome: "success",
			actor: "user",
		};
		appendChangelogEntry(entry);

		console.log(`changelog: ${timestamp}`);
		console.log(`Rollback successful: ${packageName} ${fromVersion} -> ${rollbackVersion}`);
		console.log(`elapsed: ${Math.round(performance.now() - startedAt)}ms`);
	} catch (error) {
		const originalError = error instanceof Error ? error.message : String(error);
		try {
			restoreBackup(backup);
			console.error("State restoration: passed");
		} catch (restoreError) {
			throw new Error(
				`${originalError}\nState restoration failed: ${restoreError}`,
			);
		}
		throw new Error(originalError);
	} finally {
		rmSync(BACKUP_DIR, { recursive: true, force: true });
	}
}

const packageName = process.argv.slice(2)[0];
if (!packageName) {
	console.error("Usage: bun run deps:rollback <package>");
	process.exitCode = 1;
} else {
	try {
		await rollback(packageName);
	} catch (error) {
		console.error(`Rollback error: ${error}`);
		process.exitCode = 2;
	}
}
