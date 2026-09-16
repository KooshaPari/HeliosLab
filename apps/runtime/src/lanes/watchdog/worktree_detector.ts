// T002 - Orphaned worktree detector

import { promises as fs } from "node:fs";
import path from "node:path";
import type { LaneRecord, LaneRegistry } from "../registry.js";
import type { OrphanedResource } from "./resource_classifier.js";

export class WorktreeDetector {
	constructor(
		private readonly baseDir: string,
		private readonly laneRegistry: LaneRegistry,
	) {}

	async detect(): Promise<OrphanedResource[]> {
		const orphans: OrphanedResource[] = [];

		try {
			const entries = await fs.readdir(this.baseDir, { withFileTypes: true });

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;

				const worktreePath = path.join(this.baseDir, entry.name);
				const laneId = this.extractLaneId(entry.name);

				if (!laneId) {
					// Can't extract lane ID, skip this worktree
					continue;
				}

				// Check if lane is active in registry
				const lane = this.findActiveLane(laneId);

				// Exclude transient states
				if (lane) {
					if (
						lane.state === "cleaning" ||
						(lane.state as string) === "recovering"
					) {
						continue; // Not orphaned, just in transient state
					}
					// Lane is active and not in transient state
					continue;
				}

				// No active lane found - this is orphaned
				const stats = await fs.stat(worktreePath);
				orphans.push({
					type: "worktree",
					path: worktreePath,
					createdAt: stats.birthtime.toISOString(),
					estimatedOwnerId: laneId,
				});
			}
		} catch (error) {
			console.warn(
				`Failed to read worktree directory ${this.baseDir}: ${String(error)}`,
			);
		}

		return orphans;
	}

	private extractLaneId(dirName: string): string | null {
		// Lane IDs are typically in directory names like "lane-abc123"
		const match = dirName.match(/^(lane-[a-z0-9]+)$/i);
		return match ? match[1] : null;
	}

	private findActiveLane(laneId: string): LaneRecord | null {
		try {
			return this.laneRegistry.get(laneId) || null;
		} catch {
			return null;
		}
	}
}
