import type { AuditRecord } from "./sink";

export interface AuditDurableStore {
	append(record: AuditRecord): Promise<void>;
	replay(fromRecordedAt?: string): Promise<AuditRecord[]>;
}

export class Slice1AuditDurabilityPlaceholder implements AuditDurableStore {
	async append(): Promise<void> {
		throw new Error("slice_2_durability_not_implemented");
	}

	async replay(): Promise<AuditRecord[]> {
		return [];
	}
}
