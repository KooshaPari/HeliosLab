import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuditRecord } from "./sink.js";

export interface AuditDurableStore {
	append(record: AuditRecord): Promise<void>;
	replay(fromRecordedAt?: string): Promise<AuditRecord[]>;
}

/**
 * File-backed implementation of {@link AuditDurableStore}.
 *
 * Records are written as one JSON file per record under
 * `<dataDir>/recovery/audit/<id>.json`. Writes are atomic
 * (tmp + rename) so a partial write leaves an `.tmp` artifact that
 * {@link detectOrphans} from `OrphanReconciler` can sweep later.
 *
 * The directory is created lazily on the first `append` call; a
 * missing dir at construction is fine.
 */
export class FileBackedAuditDurableStore implements AuditDurableStore {
	private readonly dir: string;

	constructor(dataDir: string) {
		if (!dataDir || typeof dataDir !== "string") {
			throw new Error("FileBackedAuditDurableStore requires a dataDir");
		}
		this.dir = path.join(dataDir, "recovery", "audit");
	}

	async append(record: AuditRecord): Promise<void> {
		const id = this.recordId(record);
		const fullPath = path.join(this.dir, `${id}.json`);

		const payload: AuditRecord = {
			...record,
			id,
			recorded_at: record.recorded_at ?? new Date().toISOString(),
			sequence: record.sequence ?? Date.now(),
		};
		const content = JSON.stringify(payload, null, 2);

		await fs.mkdir(path.dirname(fullPath), { recursive: true });
		const tempPath = `${fullPath}.tmp-${randomUUID()}`;
		const handle = await fs.open(tempPath, "w");
		try {
			await handle.writeFile(content, "utf-8");
			// Flush + fsync so the rename is durable.
			await handle.sync();
		} finally {
			await handle.close();
		}
		await fs.rename(tempPath, fullPath);
	}

	async replay(fromRecordedAt?: string): Promise<AuditRecord[]> {
		let names: string[];
		try {
			names = await fs.readdir(this.dir);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "ENOENT") return [];
			throw err;
		}

		const cutoff = fromRecordedAt
			? Date.parse(fromRecordedAt)
			: Number.NEGATIVE_INFINITY;
		const records: AuditRecord[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			const fullPath = path.join(this.dir, name);
			try {
				const raw = await fs.readFile(fullPath, "utf-8");
				const parsed = JSON.parse(raw) as AuditRecord;
				const recordedAt = parsed.recorded_at;
				const recordedAtMs =
					typeof recordedAt === "string" ? Date.parse(recordedAt) : NaN;
				if (Number.isNaN(recordedAtMs)) continue;
				if (recordedAtMs < cutoff) continue;
				records.push(parsed);
			} catch {
				// Best-effort: corrupted files are skipped here and
				// surfaced separately by OrphanReconciler.detectOrphans.
			}
		}
		records.sort((a, b) => {
			const aMs = Date.parse(a.recorded_at);
			const bMs = Date.parse(b.recorded_at);
			return aMs - bMs;
		});
		return records;
	}

	private recordId(record: AuditRecord): string {
		if (record.id && typeof record.id === "string") {
			return record.id.replace(/[^a-zA-Z0-9_-]/g, "_");
		}
		const seed = `${record.recorded_at ?? ""}|${record.sequence ?? ""}|${randomUUID()}`;
		return createHash("sha256").update(seed).digest("hex").slice(0, 24);
	}
}

/**
 * @deprecated Retained only so existing tests that reference the
 * placeholder name keep compiling. Real consumers should use
 * {@link FileBackedAuditDurableStore}.
 */
export class Slice1AuditDurabilityPlaceholder implements AuditDurableStore {
	async append(): Promise<void> {
		throw new Error("slice_2_durability_not_implemented");
	}

	async replay(): Promise<AuditRecord[]> {
		return [];
	}
}
