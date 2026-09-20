import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LocalBus } from "../protocol/bus.js";
import { detectOrphansImpl } from "./orphan-detection.js";
import { enforceRetentionImpl } from "./orphan-retention.js";

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
	 * Delegate to {@link detectOrphansImpl}; see that module for the
	 * detection rules. Kept as a method so callers written against
	 * the class API (tests, runtime wiring) keep compiling.
	 */
	async detectOrphans(dataDir: string): Promise<OrphanReport> {
		return detectOrphansImpl(dataDir, this.restoredSessionIds);
	}

	/**
	 * Delegate to {@link enforceRetentionImpl}; see that module for
	 * the retention policy. Kept as a method for the same reason as
	 * {@link detectOrphans}.
	 */
	async enforceRetention(options: RetentionOptions): Promise<RetentionResult> {
		return enforceRetentionImpl(options);
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
