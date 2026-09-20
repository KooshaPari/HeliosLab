import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertSafeId } from "../recovery/safe-id.js";

export type SessionCheckpoint = {
	checkpoint_id: string;
	workspace_id: string;
	lane_id: string;
	session_id: string;
	created_at: string;
	cursor: string;
	payload: Record<string, unknown>;
};

export interface CheckpointStore {
	save(checkpoint: SessionCheckpoint): Promise<void>;
	latest(sessionId: string): Promise<SessionCheckpoint | null>;
	list(sessionId: string): Promise<SessionCheckpoint[]>;
}

/**
 * File-backed implementation of {@link CheckpointStore}.
 *
 * Each session gets its own subdirectory under
 * `<dataDir>/recovery/sessions/<session_id>/`. One
 * `<checkpoint_id>.json` per checkpoint inside that subdirectory,
 * written atomically (tmp + rename) so {@link detectOrphans} can
 * sweep leftovers later.
 */
export class FileBackedCheckpointStore implements CheckpointStore {
	private readonly baseDir: string;

	constructor(dataDir: string) {
		if (!dataDir || typeof dataDir !== "string") {
			throw new Error("FileBackedCheckpointStore requires a dataDir");
		}
		this.baseDir = path.join(dataDir, "recovery", "sessions");
	}

	async save(checkpoint: SessionCheckpoint): Promise<void> {
		// Reject path-traversal attempts before the identifiers reach
		// `path.join`. Both fields are attacker-controllable through
		// the bus envelope, so any unsafe character or `..` segment
		// is an error rather than a silent rewrite — `save` must
		// never write outside `<dataDir>/recovery/sessions/<sessionId>`.
		assertSafeId(checkpoint.session_id, "SessionCheckpoint.session_id");
		const providedCheckpointId =
			typeof checkpoint.checkpoint_id === "string" &&
			checkpoint.checkpoint_id.length > 0
				? checkpoint.checkpoint_id
				: undefined;
		if (providedCheckpointId) {
			assertSafeId(providedCheckpointId, "SessionCheckpoint.checkpoint_id");
		}
		const checkpointId = providedCheckpointId ?? randomUUID();
		const sessionId = checkpoint.session_id;
		const dir = path.join(this.baseDir, sessionId);
		const fullPath = path.join(dir, `${checkpointId}.json`);

		const record: SessionCheckpoint = {
			...checkpoint,
			checkpoint_id: checkpointId,
			created_at:
				checkpoint.created_at && checkpoint.created_at.length > 0
					? checkpoint.created_at
					: new Date().toISOString(),
		};
		const content = JSON.stringify(record, null, 2);

		await fs.mkdir(dir, { recursive: true });
		const tempPath = `${fullPath}.tmp-${randomUUID()}`;
		const handle = await fs.open(tempPath, "w");
		try {
			await handle.writeFile(content, "utf-8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await fs.rename(tempPath, fullPath);
	}

	async latest(sessionId: string): Promise<SessionCheckpoint | null> {
		const checkpoints = await this.list(sessionId);
		if (checkpoints.length === 0) return null;
		// `list` returns ascending-by-created_at, so the latest is the last.
		return checkpoints[checkpoints.length - 1];
	}

	async list(sessionId: string): Promise<SessionCheckpoint[]> {
		// Same path-traversal guard as `save` — `list` would otherwise
		// leak the contents of arbitrary directories.
		assertSafeId(sessionId, "sessionId");
		const dir = path.join(this.baseDir, sessionId);
		let names: string[];
		try {
			names = await fs.readdir(dir);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT") return [];
			throw err;
		}

		const checkpoints: SessionCheckpoint[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			const fullPath = path.join(dir, name);
			try {
				const raw = await fs.readFile(fullPath, "utf-8");
				const parsed = JSON.parse(raw) as SessionCheckpoint;
				checkpoints.push(parsed);
			} catch {
				// Skip corrupted files; OrphanReconciler.detectOrphans
				// will flag the leftover on the next reconciliation pass.
			}
		}
		checkpoints.sort((a, b) => {
			const aMs = Date.parse(a.created_at);
			const bMs = Date.parse(b.created_at);
			return aMs - bMs;
		});
		return checkpoints;
	}
}

/**
 * @deprecated Retained only so existing tests that reference the
 * placeholder name keep compiling. Real consumers should use
 * {@link FileBackedCheckpointStore}.
 */
export class Slice1CheckpointStorePlaceholder implements CheckpointStore {
	async save(_checkpoint: SessionCheckpoint): Promise<void> {
		throw new Error("slice_2_durability_not_implemented");
	}

	async latest(_sessionId: string): Promise<SessionCheckpoint | null> {
		return null;
	}

	async list(_sessionId: string): Promise<SessionCheckpoint[]> {
		return [];
	}
}
