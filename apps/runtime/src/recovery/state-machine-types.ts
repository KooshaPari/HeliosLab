export enum RecoveryStage {
	CRASHED = "CRASHED",
	DETECTING = "DETECTING",
	INVENTORYING = "INVENTORYING",
	RESTORING = "RESTORING",
	RECONCILING = "RECONCILING",
	LIVE = "LIVE",
	DETECTION_FAILED = "DETECTION_FAILED",
	INVENTORY_FAILED = "INVENTORY_FAILED",
	RESTORATION_FAILED = "RESTORATION_FAILED",
	RECONCILIATION_FAILED = "RECONCILIATION_FAILED",
}

export interface RecoveryState {
	stage: RecoveryStage;
	timestamp: number;
	attemptCount: number;
	lastError?: string;
}

export type StageChangeListener = (
	previous: RecoveryStage,
	current: RecoveryStage,
	attemptCount: number,
) => void;

export const MAX_RETRIES_PER_STAGE = 3;
export const STAGE_TIMEOUT_MS = 30_000;
