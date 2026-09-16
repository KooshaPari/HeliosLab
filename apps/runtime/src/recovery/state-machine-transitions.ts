import { RecoveryStage } from "./state-machine-types.js";

export const LEGAL_TRANSITIONS: Record<RecoveryStage, RecoveryStage[]> = {
	[RecoveryStage.CRASHED]: [RecoveryStage.DETECTING],
	[RecoveryStage.DETECTING]: [
		RecoveryStage.INVENTORYING,
		RecoveryStage.DETECTION_FAILED,
	],
	[RecoveryStage.INVENTORYING]: [
		RecoveryStage.RESTORING,
		RecoveryStage.INVENTORY_FAILED,
	],
	[RecoveryStage.RESTORING]: [
		RecoveryStage.RECONCILING,
		RecoveryStage.RESTORATION_FAILED,
	],
	[RecoveryStage.RECONCILING]: [
		RecoveryStage.LIVE,
		RecoveryStage.RECONCILIATION_FAILED,
	],
	[RecoveryStage.LIVE]: [],
	[RecoveryStage.DETECTION_FAILED]: [RecoveryStage.DETECTING],
	[RecoveryStage.INVENTORY_FAILED]: [RecoveryStage.INVENTORYING],
	[RecoveryStage.RESTORATION_FAILED]: [RecoveryStage.RESTORING],
	[RecoveryStage.RECONCILIATION_FAILED]: [RecoveryStage.RECONCILING],
};

export function isFailureState(stage: RecoveryStage): boolean {
	return stage && typeof stage === "string" && stage.includes("FAILED");
}

export function getFailureStateFor(
	stage: RecoveryStage,
): RecoveryStage | undefined {
	const failureMap: Record<RecoveryStage, RecoveryStage | undefined> = {
		[RecoveryStage.DETECTING]: RecoveryStage.DETECTION_FAILED,
		[RecoveryStage.INVENTORYING]: RecoveryStage.INVENTORY_FAILED,
		[RecoveryStage.RESTORING]: RecoveryStage.RESTORATION_FAILED,
		[RecoveryStage.RECONCILING]: RecoveryStage.RECONCILIATION_FAILED,
		[RecoveryStage.CRASHED]: RecoveryStage.CRASHED,
		[RecoveryStage.LIVE]: undefined,
		[RecoveryStage.DETECTION_FAILED]: undefined,
		[RecoveryStage.INVENTORY_FAILED]: undefined,
		[RecoveryStage.RESTORATION_FAILED]: undefined,
		[RecoveryStage.RECONCILIATION_FAILED]: undefined,
	};
	return failureMap[stage];
}
