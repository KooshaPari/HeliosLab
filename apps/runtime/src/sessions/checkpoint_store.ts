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
