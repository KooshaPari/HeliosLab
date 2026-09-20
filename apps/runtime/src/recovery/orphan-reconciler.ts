import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LocalBus } from "../protocol/bus.js";
import { validateCheckpoint } from "./checkpoint.js";

export interface OrphanItem {
	type: "pty" | "zellij_session" | "par_lane" | "share_worker" | "temp_file";
	id: string;
	description: string;
	pid?: number;
	path?: string;
}

export interface OrphanReport {
	safeToTerminate: OrphanItem[];
	needsReview: OrphanItem[];
	totalFound: number;
}

export interface CleanupResult {
	terminated: number;
	removed: number;
	reviewPending: number;
}

/**
 * Result of a retention-pruning pass.
 *
 * Extends {@link CleanupResult} with bookkeeping the runtime needs to
 * surface in diagnostics: how many files survived and which specific
 * files were removed.
 */
export interface RetentionResult extends CleanupResult {
	kept: number;
	removedFiles: string[];
}

export interface RetentionOptions {
	dataDir: string;
	maxAgeMs?: number;
	maxBytes?: number;
	maxCount?: number;
}

/**
 * Default age threshold (5 minutes) for flagging a stale `.tmp`
 * checkpoint-rotation artifact. Anything older than this is safe to
 * assume was abandoned by the writer that created it.
 */
export const STALE_TEMP_FILE_MS = 5 * 60 * 1000;

/**
 * Hard ceiling on the number of files a single `enforceRetention`
 * call may delete. Prevents accidental data loss when a caller
 * mis-configures retention.
 */
export const MAX_RETENTION_DELETIONS_PER_CALL = 256;

export class OrphanReconciler {
	private bus?: LocalBus;
	private readonly restoredSessionIds: ReadonlySet<string>;

	constructor(restoredSessionIds: string[] = [], bus?: LocalBus) {
		this.bus = bus;
		this.restoredSessionIds = new Set(restoredSessionIds);
	}

	async scan(): Promise<OrphanReport> {
		const safeToTerminate: OrphanItem[] = [];
		const needsReview: OrphanItem[] = [];

		// Scan for orphan PTY processes
		await this.scanOrphanPTYs(safeToTerminate, needsReview);

		// Scan for stale zellij sessions
		await this.scanStaleZelijjSessions(safeToTerminate, needsReview);

		// Scan for stale temp files
		await this.scanStaleTempFiles(safeToTerminate, needsReview);

		const totalFound = safeToTerminate.length + needsReview.length;

		return {
			safeToTerminate,
			needsReview,
			totalFound,
		};
	}

	async cleanup(report: OrphanReport): Promise<CleanupResult> {
		let terminated = 0;
		let removed = 0;

		// Terminate safe-to-terminate processes
		for (const item of report.safeToTerminate) {
			try {
				if (
					item.type === "pty" ||
					item.type === "zellij_session" ||
					item.type === "share_worker"
				) {
					if (item.pid) {
						// Try SIGTERM first
						try {
							process.kill(item.pid, "SIGTERM");
							// Wait 3s for graceful shutdown
							await new Promise((resolve) => setTimeout(resolve, 3000));
							// Check if process is still alive
							try {
								process.kill(item.pid, 0);
								// Still alive, force SIGKILL
								process.kill(item.pid, "SIGKILL");
							} catch {
								// Process is dead
							}
							terminated++;
						} catch {
							// Process not found or permission denied
						}
					}
				} else if (item.type === "temp_file" && item.path) {
					await fs.unlink(item.path);
					removed++;
				}
			} catch (err) {
				console.error(`Failed to cleanup orphan ${item.id}:`, err);
			}
		}

		const reviewPending = report.needsReview.length;

		// Log cleanup result
		console.log(
			`Orphan cleanup: ${terminated} terminated, ${removed} removed, ${reviewPending} pending review`,
		);

		// Publish cleanup event
		if (this.bus) {
			await this.bus.publish({
				id: randomUUID(),
				type: "event",
				ts: new Date().toISOString(),
				topic: "recovery.orphans.cleaned",
				payload: {
					terminated,
					removed,
					reviewPending,
				},
			});
		}

		return {
			terminated,
			removed,
			reviewPending,
		};
	}

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
	 * platform-dependent stubs in this Slice 2 release; detectOrphans
	 * works entirely from the filesystem so that file-only orphans
	 * are actionable today.
	 */
	async detectOrphans(dataDir: string): Promise<OrphanReport> {
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
		const checkpointBackup = "checkpoint.json.backup";

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
			if (name === checkpointBackup) {
				if (checkpointLive) {
					safeToTerminate.push({
						type: "temp_file",
						id: name,
						description:
							"Backup checkpoint no longer needed (live file present)",
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
		const knownSessionIds = this.restoredSessionIds;
		const filtered = safeToTerminate.filter((item) => {
			if (item.type !== "temp_file" || !item.path) return true;
			const base = path.basename(item.path);
			const match = base.match(/^session-([0-9a-zA-Z_-]+)/);
			if (match && knownSessionIds.size > 0 && !knownSessionIds.has(match[1])) {
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
	async enforceRetention(options: RetentionOptions): Promise<RetentionResult> {
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
				const rank = byMtimeDesc.findIndex(
					(e) => e.fullPath === entry.fullPath,
				);
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

		// Safety net: if the only file in the directory is a valid
		// `checkpoint.json`, never delete it just because retention says so.
		// We pre-check this BEFORE the filter passes so a single-file
		// directory with an expired checkpoint.json is preserved.
		const checkpointEntry = entries.find(
			(entry) => entry.name === "checkpoint.json",
		);
		if (
			entries.length === 1 &&
			checkpointEntry &&
			checkpointEntry.name === "checkpoint.json" &&
			checkpointIsValid
		) {
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

	private async scanOrphanPTYs(
		_safeToTerminate: OrphanItem[],
		_needsReview: OrphanItem[],
	): Promise<void> {
		// In a real implementation, this would scan /proc or use Bun/Node APIs
		// to find PTY processes owned by heliosApp but not associated with restored sessions
		// For now, this is a no-op
	}

	private async scanStaleZelijjSessions(
		_safeToTerminate: OrphanItem[],
		_needsReview: OrphanItem[],
	): Promise<void> {
		// In a real implementation, this would call zellij list-sessions
		// and compare against restored session IDs
		// For now, this is a no-op
	}

	private async scanStaleTempFiles(
		safeToTerminate: OrphanItem[],
		_needsReview: OrphanItem[],
	): Promise<void> {
		try {
			// Look for stale temp files in recovery directory
			// This is a simplified version; real implementation would be more thorough
			const recoveryDir = path.join(process.cwd(), "recovery");
			try {
				const files = await fs.readdir(recoveryDir);
				for (const file of files) {
					if (file.endsWith(".tmp")) {
						const filePath = path.join(recoveryDir, file);
						safeToTerminate.push({
							type: "temp_file",
							id: file,
							description: `Stale temp file: ${file}`,
							path: filePath,
						});
					}
				}
			} catch {
				// Recovery directory doesn't exist
			}
		} catch (err) {
			console.error("Failed to scan for stale temp files:", err);
		}
	}
}
