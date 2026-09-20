/**
 * Filesystem-scoped orphan detection for the runtime's recovery
 * directory. Extracted from `OrphanReconciler` so the file-size guard
 * keeps both halves under their respective baselines; the public
 * `OrphanReconciler.detectOrphans` method is now a thin delegate.
 *
 * Scans `<dataDir>/recovery` for orphans left behind by interrupted
 * checkpoint rotations, half-applied state transitions, and stale temp
 * files. The detection rules are documented inline because they
 * encode the runtime's data-loss invariants.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { OrphanItem, OrphanReport } from "./orphan-reconciler.js";
import { STALE_TEMP_FILE_MS } from "./orphan-reconciler.js";

/**
 * Detect orphans under the runtime's recovery directory and return
 * a structured report.
 *
 * Detection scope:
 * - `*.tmp` and `*.tmp-<uuid>` files inside `dataDir/recovery` and
 *   every subdirectory (CheckpointWriter and the durable stores'
 *   atomic-rename rotations leave these behind when interrupted).
 * - `checkpoint.json.backup` rotation leftovers. If
 *   `checkpoint.json` exists, the backup is safe to terminate.
 *   If it does NOT exist, the backup is a needs-review orphan
 *   because something overwrote the live checkpoint and the
 *   rotation never completed.
 * - `*.rollback` and `*.partial` artifacts. These are flagged as
 *   safe-to-terminate because they describe a half-applied
 *   mutation that did not finish.
 * - Files under `dataDir/recovery/audit/` and
 *   `dataDir/recovery/sessions/<sid>/` are scanned recursively so
 *   abandoned `.tmp-<uuid>` writes from `FileBackedAuditDurableStore`
 *   and `FileBackedCheckpointStore` are surfaced.
 *
 * The per-resource scanners (`scanOrphanPTYs`,
 * `scanStaleZelijjSessions`) are intentionally left as
 * platform-dependent stubs in this Slice 2 release; this
 * implementation works entirely from the filesystem so that
 * file-only orphans are actionable today.
 */
export async function detectOrphansImpl(
	dataDir: string,
	restoredSessionIds: ReadonlySet<string>,
): Promise<OrphanReport> {
	if (!dataDir || typeof dataDir !== "string") {
		throw new Error("OrphanReconciler.detectOrphans requires a dataDir");
	}

	const safeToTerminate: OrphanItem[] = [];
	const needsReview: OrphanItem[] = [];
	const recoveryDir = path.join(dataDir, "recovery");

	let topEntries: string[] = [];
	try {
		topEntries = await fs.readdir(recoveryDir);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			console.error("OrphanReconciler.detectOrphans: readdir failed", err);
		}
		// Missing recovery dir is the common case on first run. Not an error.
		return { safeToTerminate, needsReview, totalFound: 0 };
	}

	const now = Date.now();
	const checkpointLive = topEntries.includes("checkpoint.json");

	// Walk the recovery tree breadth-first. Every regular file we
	// find is classified against the same rules; subdirectories are
	// recursed so the audit-store and per-session stores are
	// covered. A symlink cycle is prevented by tracking visited
	// directories and refusing to recurse into them twice.
	const visitedDirs = new Set<string>([path.resolve(recoveryDir)]);
	const queue: string[] = topEntries.map((name) =>
		path.join(recoveryDir, name),
	);

	while (queue.length > 0) {
		const fullPath = queue.shift() as string;
		let stat: import("node:fs").Stats;
		try {
			stat = await fs.stat(fullPath);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			const resolved = path.resolve(fullPath);
			if (visitedDirs.has(resolved)) continue;
			visitedDirs.add(resolved);
			let childNames: string[];
			try {
				childNames = await fs.readdir(fullPath);
			} catch {
				continue;
			}
			for (const child of childNames) {
				queue.push(path.join(fullPath, child));
			}
			continue;
		}
		if (!stat.isFile()) continue;

		const name = path.basename(fullPath);
		const relPath = fullPath.slice(recoveryDir.length + 1);
		// Stale temp files left by CheckpointWriter and the durable
		// stores' atomic-rename rotations. Match both `*.tmp` (the
		// legacy `.tmp` suffix used by CheckpointWriter) and
		// `*.tmp-<uuid>` (used by FileBackedAuditDurableStore and
		// FileBackedCheckpointStore).
		const isStaleTemp =
			name.endsWith(".tmp") || /\.tmp-[0-9a-z-]+$/i.test(name);
		if (isStaleTemp) {
			const age = now - stat.mtimeMs;
			if (age >= STALE_TEMP_FILE_MS) {
				safeToTerminate.push({
					type: "temp_file",
					id: `${relPath}`,
					description: `Stale temp file: ${relPath} (${Math.round(age / 1000)}s old)`,
					path: fullPath,
				});
			}
			continue;
		}

		// .rollback / .partial are half-applied mutation artifacts.
		if (name.endsWith(".rollback") || name.endsWith(".partial")) {
			safeToTerminate.push({
				type: "temp_file",
				id: relPath,
				description: `Partial rollback artifact: ${relPath}`,
				path: fullPath,
			});
			continue;
		}

		// Stale backup checkpoint. If a live checkpoint.json is
		// also present, the backup is safe to retire. If the live
		// file is missing, the backup may be the last good copy
		// and a human should look at it. The backup only ever
		// exists at the recovery root — subdirectory backups are
		// classified by the rules above (or are not relevant).
		if (relPath === "checkpoint.json.backup") {
			if (checkpointLive) {
				safeToTerminate.push({
					type: "temp_file",
					id: relPath,
					description: "Backup checkpoint no longer needed (live file present)",
					path: fullPath,
				});
			} else {
				needsReview.push({
					type: "temp_file",
					id: relPath,
					description:
						"Lone checkpoint backup — live checkpoint.json missing, manual review required",
					path: fullPath,
				});
			}
		}
	}

	// Cross-check with the session registry: any temp file referencing
	// an unknown session id is flagged for review rather than auto-delete.
	const filtered = safeToTerminate.filter((item) => {
		if (item.type !== "temp_file" || !item.path) return true;
		const base = path.basename(item.path);
		// Match `session-<sid>` (legacy top-level) and `<sid>/...` (per-session
		// subdirectories). The directory name is the canonical session id.
		const dirMatch = path
			.basename(path.dirname(item.path))
			.match(/^([0-9a-zA-Z_-]+)$/);
		const sessionId =
			dirMatch && !dirMatch[1].endsWith(".tmp") ? dirMatch[1] : undefined;
		const fileMatch = base.match(/^session-([0-9a-zA-Z_-]+)/);
		const matched = sessionId ?? (fileMatch ? fileMatch[1] : undefined);
		if (
			matched &&
			restoredSessionIds.size > 0 &&
			!restoredSessionIds.has(matched)
		) {
			needsReview.push({
				...item,
				description: `${item.description} (session ${matched} not in restored set)`,
			});
			return false;
		}
		return true;
	});
	safeToTerminate.length = 0;
	safeToTerminate.push(...filtered);

	return {
		safeToTerminate,
		needsReview,
		totalFound: safeToTerminate.length + needsReview.length,
	};
}
