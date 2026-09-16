/**
 * Approval types for the desktop UI
 */

export enum ApprovalStatus {
	Pending = "pending",
	Approved = "approved",
	Rejected = "rejected",
	Expired = "expired",
}

export interface ApprovalRequest {
	id: string;
	command: string;
	workspaceId: string;
	agentId: string;
	requesterName: string;
	status: ApprovalStatus;
	createdAt: string;
	expiresAt: string;
	approvedBy?: string;
	approvedAt?: string;
	rejectedReason?: string;
}

export interface ApprovalWorkflow {
	userId: string;
	totalRequests: number;
	pendingRequests: number;
	approvedRequests: number;
	rejectedRequests: number;
}
