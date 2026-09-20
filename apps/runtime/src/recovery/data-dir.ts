/**
 * Default data directory resolver for runtime durability.
 *
 * Convention (Option A):
 *   <root>/<workspace-id>/recovery
 *
 * Root defaults to `~/.helios/data/` so it matches the existing
 * `JsonFilePersistence` global data location. The workspace-id is
 * derived from a stable hash of `process.cwd()` combined with the
 * project fingerprint (package.json content) so two different
 * workspaces do not collide, but the same workspace always resolves
 * to the same path.
 *
 * The target directory is created recursively on demand. Tests can
 * override `HOME` (or use `setHome`) to isolate the result under a
 * temporary directory.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_HELIOS_HOME = ".helios";
export const DEFAULT_DATA_SUBDIR = "data";
export const WORKSPACE_ID_LENGTH = 16;

let cachedHome: string | undefined;

/**
 * Override the value that `os.homedir()` returns for the current
 * process. Tests use this to redirect the resolver into a temp dir.
 *
 * Pass `undefined` to fall back to the platform default again.
 */
export function setHome(home: string | undefined): void {
	cachedHome = home;
}

export function getHome(): string {
	if (cachedHome !== undefined) {
		return cachedHome;
	}
	return os.homedir();
}

/**
 * Reset the resolver's home override. Mostly useful in test setup
 * hooks that have to wipe state between cases.
 */
export function resetHome(): void {
	cachedHome = undefined;
}

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await fs.access(candidate);
		return true;
	} catch {
		return false;
	}
}

async function findPackageJson(startDir: string): Promise<string | null> {
	let current = path.resolve(startDir);
	const root = path.parse(current).root;
	while (true) {
		const candidate = path.join(current, "package.json");
		if (await pathExists(candidate)) {
			return candidate;
		}
		if (current === root) {
			return null;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

/**
 * Compute a stable workspace-id from a working directory.
 *
 * Strategy:
 * 1. Walk up from the cwd until we find a package.json, otherwise
 *    fall back to the cwd path itself.
 * 2. SHA-256 the cwd + package.json content (or just cwd if absent).
 * 3. Truncate to `WORKSPACE_ID_LENGTH` hex characters.
 *
 * The result is intentionally filesystem-safe (lowercase hex only).
 */
export async function deriveWorkspaceId(cwd: string): Promise<string> {
	const pkgPath = await findPackageJson(cwd);
	let fingerprint = cwd;
	if (pkgPath) {
		try {
			const content = await fs.readFile(pkgPath, "utf-8");
			fingerprint = `${cwd}::${content}`;
		} catch {
			// Ignore unreadable package.json; the cwd is still enough
			// to produce a stable id.
		}
	}
	const hash = createHash("sha256").update(fingerprint).digest("hex");
	return hash.slice(0, WORKSPACE_ID_LENGTH);
}

/**
 * Resolve the runtime's default data directory for the current
 * workspace, creating it (and its parent directories) if missing.
 *
 * The returned path is `<root>/<workspace-id>`. Recovery artifacts
 * (`recovery/checkpoint.json`, etc.) are written inside the resolved
 * directory by `CheckpointWriter` and friends. Keeping the recovery
 * subdir out of the resolver avoids double-nesting when writers
 * blindly append `recovery/`.
 *
 * `workspaceId` may be supplied explicitly when the caller already
 * knows it (e.g., from a workspace registry); otherwise the resolver
 * derives one from the process cwd + nearest package.json.
 */
export async function resolveDefaultDataDir(
	workspaceId?: string,
): Promise<string> {
	const home = getHome();
	const root = path.join(home, DEFAULT_HELIOS_HOME, DEFAULT_DATA_SUBDIR);
	const id =
		workspaceId !== undefined && workspaceId.length > 0
			? workspaceId
			: await deriveWorkspaceId(process.cwd());
	const target = path.join(root, id);
	await fs.mkdir(target, { recursive: true });
	return target;
}

/**
 * Synchronous cousin of {@link resolveDefaultDataDir}. Use this when
 * a caller needs a path but cannot await during initialization.
 *
 * Caveat: this does NOT create the directory. Callers that want
 * fs creation must await the async variant.
 */
export function resolveDefaultDataDirSync(workspaceId?: string): string {
	const home = getHome();
	const root = path.join(home, DEFAULT_HELIOS_HOME, DEFAULT_DATA_SUBDIR);
	const id = workspaceId ?? "<derived>";
	return path.join(root, id);
}
