/**
 * Filesystem-scoped retention pruning for the runtime's recovery
 * directory. Extracted from `OrphanReconciler` so the file-size guard
 * keeps both halves under their respective baselines; the public
 * `OrphanReconciler.enforceRetention` method is now a thin delegate.
 *
 * Implements the mtime/age and size-budget trimming policy described
 * on {@link enforceRetentionImpl}. The safety net that preserves a
 * last surviving valid `checkpoint.json` lives here as well.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { validateCheckpoint } from "./checkpoint.js";
import type { RetentionOptions, RetentionResult } from "./orphan-reconciler.js";
import { MAX_RETENTION_DELETIONS_PER_CALL } from "./orphan-reconciler.js";

/**
 * Prune the recovery directory under `dataDir` so it stays within
 * configured retention bounds. Trims oldest-first by mtime, never
 * deletes a valid live `checkpoint.json`, and caps any single call
 * at {@link MAX_RETENTION_DELETIONS_PER_CALL} deletions for
 * safety.
 *
 * Filters run in this order:
 * 1. Files older than `maxAgeMs` are removed.
 * 2. If `maxCount` is set, only the N newest files survive.
 * 3. If `maxBytes` is set, oldest files are removed until the
 *    total size is under the budget.
 *
 * Returns a {@link RetentionResult} describing what was kept and
 * removed; the caller can persist this to the audit ledger if it
 * wants a forensic trail.
 */
export async function enforceRetentionImpl(
	options: RetentionOptions,
): Promise<RetentionResult> {
	const { dataDir, maxAgeMs, maxBytes, maxCount } = options;
	if (!dataDir || typeof dataDir !== "string") {
		throw new Error("OrphanReconciler.enforceRetention requires a dataDir");
	}

	const recoveryDir = path.join(dataDir, "recovery");

	interface FileEntry {
		name: string;
		fullPath: string;
		mtimeMs: number;
		size: number;
	}

	let listed: string[];
	try {
		listed = await fs.readdir(recoveryDir);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return {
				terminated: 0,
				removed: 0,
				reviewPending: 0,
				kept: 0,
				removedFiles: [],
			};
		}
		throw err;
	}

	const entries: FileEntry[] = [];
	let checkpointIsValid = false;
	for (const name of listed) {
		const fullPath = path.join(recoveryDir, name);
		let stat: import("node:fs").Stats;
		try {
			stat = await fs.stat(fullPath);
		} catch {
			continue;
		}
		if (!stat.isFile()) continue;
		entries.push({
			name,
			fullPath,
			mtimeMs: stat.mtimeMs,
			size: stat.size,
		});
		if (name === "checkpoint.json") {
			try {
				const raw = await fs.readFile(fullPath, "utf-8");
				const parsed = JSON.parse(raw);
				checkpointIsValid = validateCheckpoint(parsed).valid;
			} catch {
				checkpointIsValid = false;
			}
		}
	}

	// newest-first ordering for "trim to N newest"
	const byMtimeDesc = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs);
	// oldest-first for age + bytes filtering
	const byMtimeAsc = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);

	const now = Date.now();
	const removed = new Set<string>();

	// Pass 1: age
	if (typeof maxAgeMs === "number" && maxAgeMs >= 0) {
		for (const entry of byMtimeAsc) {
			if (removed.size >= MAX_RETENTION_DELETIONS_PER_CALL) break;
			if (now - entry.mtimeMs > maxAgeMs) {
				removed.add(entry.fullPath);
			}
		}
	}

	// Pass 2: count (keep newest N)
	if (typeof maxCount === "number" && maxCount >= 0) {
		for (const entry of byMtimeAsc) {
			if (removed.size >= MAX_RETENTION_DELETIONS_PER_CALL) break;
			// newest maxCount entries survive; the rest go.
			const rank = byMtimeDesc.findIndex((e) => e.fullPath === entry.fullPath);
			if (rank >= maxCount) {
				removed.add(entry.fullPath);
			}
		}
	}

	// Pass 3: byte budget (oldest first)
	if (typeof maxBytes === "number" && maxBytes >= 0) {
		let total = entries
			.filter((e) => !removed.has(e.fullPath))
			.reduce((acc, e) => acc + e.size, 0);
		for (const entry of byMtimeAsc) {
			if (removed.size >= MAX_RETENTION_DELETIONS_PER_CALL) break;
			if (total <= maxBytes) break;
			if (removed.has(entry.fullPath)) continue;
			removed.add(entry.fullPath);
			total -= entry.size;
		}
	}

	// Safety net: never delete a valid live `checkpoint.json` regardless
	// of how many unrelated files share the directory. The previous
	// guard only triggered when the directory contained a single file,
	// so an expired `.tmp` companion could still let the age/count/bytes
	// passes remove the only valid checkpoint.
	const checkpointEntry = entries.find(
		(entry) => entry.name === "checkpoint.json",
	);
	if (checkpointIsValid && checkpointEntry) {
		removed.delete(checkpointEntry.fullPath);
	}

	// Sort removals by mtime so the result is deterministic.
	const removedList = entries
		.filter((e) => removed.has(e.fullPath))
		.sort((a, b) => a.mtimeMs - b.mtimeMs);

	for (const entry of removedList) {
		try {
			await fs.unlink(entry.fullPath);
		} catch (err) {
			console.error(
				`OrphanReconciler.enforceRetention: failed to delete ${entry.fullPath}`,
				err,
			);
		}
	}

	const kept = entries.filter((e) => !removed.has(e.fullPath)).length;
	console.log(
		`Retention: kept ${kept}, removed ${removedList.length} (maxAgeMs=${maxAgeMs ?? "-"}, maxCount=${maxCount ?? "-"}, maxBytes=${maxBytes ?? "-"})`,
	);

	return {
		terminated: 0,
		removed: removedList.length,
		reviewPending: 0,
		kept,
		removedFiles: removedList.map((e) => e.fullPath),
	};
}
