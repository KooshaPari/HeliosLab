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
 * - `*.tmp` files inside `dataDir/recovery` (CheckpointWriter
 *   rotations that were abandoned mid-write).
 * - `checkpoint.json.backup` rotation leftovers. If
 *   `checkpoint.json` exists, the backup is safe to terminate.
 *   If it does NOT exist, the backup is a needs-review orphan
 *   because something overwrote the live checkpoint and the
 *   rotation never completed.
 * - `*.rollback` and `*.partial` artifacts. These are flagged as
 *   safe-to-terminate because they describe a half-applied
 *   mutation that did not finish.
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

	let entries: string[] = [];
	try {
		entries = await fs.readdir(recoveryDir);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			console.error("OrphanReconciler.detectOrphans: readdir failed", err);
		}
		// Missing recovery dir is the common case on first run. Not an error.
		return { safeToTerminate, needsReview, totalFound: 0 };
	}

	const now = Date.now();
	const checkpointLive = entries.includes("checkpoint.json");

	for (const name of entries) {
		const fullPath = path.join(recoveryDir, name);
		let stat: import("node:fs").Stats;
		try {
			stat = await fs.stat(fullPath);
		} catch {
			continue;
		}
		if (!stat.isFile()) continue;

		// Stale .tmp files left by CheckpointWriter rotations that
		// crashed before fsync + rename completed.
		if (name.endsWith(".tmp")) {
			const age = now - stat.mtimeMs;
			if (age >= STALE_TEMP_FILE_MS) {
				safeToTerminate.push({
					type: "temp_file",
					id: name,
					description: `Stale temp file: ${name} (${Math.round(age / 1000)}s old)`,
					path: fullPath,
				});
			}
			continue;
		}

		// .rollback / .partial are half-applied mutation artifacts.
		if (name.endsWith(".rollback") || name.endsWith(".partial")) {
			safeToTerminate.push({
				type: "temp_file",
				id: name,
				description: `Partial rollback artifact: ${name}`,
				path: fullPath,
			});
			continue;
		}

		// Stale backup checkpoint. If a live checkpoint.json is
		// also present, the backup is safe to retire. If the live
		// file is missing, the backup may be the last good copy
		// and a human should look at it.
		if (name === "checkpoint.json.backup") {
			if (checkpointLive) {
				safeToTerminate.push({
					type: "temp_file",
					id: name,
					description: "Backup checkpoint no longer needed (live file present)",
					path: fullPath,
				});
			} else {
				needsReview.push({
					type: "temp_file",
					id: name,
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
		const match = base.match(/^session-([0-9a-zA-Z_-]+)/);
		if (
			match &&
			restoredSessionIds.size > 0 &&
			!restoredSessionIds.has(match[1])
		) {
			needsReview.push({
				...item,
				description: `${item.description} (session ${match[1]} not in restored set)`,
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
