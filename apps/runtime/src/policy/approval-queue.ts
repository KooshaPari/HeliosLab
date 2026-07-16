/**
 * Approval Request Queue
 * Manages pending approval requests for commands.
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
  approvedReason?: string;
  rejectedReason?: string;
}

/**
 * Manages approval requests for commands requiring authorization.
 */
export class ApprovalQueue {
  private requests: Map<string, ApprovalRequest> = new Map();
  private expireTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly defaultExpiryMs = 24 * 60 * 60 * 1000; // 24 hours
  private readonly timeoutDenialReason = "Approval request timed out; default action: deny";

  /**
   * Create an approval request.
   */
  createRequest(
    command: string,
    workspaceId: string,
    agentId: string,
    requesterName: string,
    expiryMs?: number
  ): ApprovalRequest {
    const timeoutMs = this.resolveExpiryMs(expiryMs);
    const id = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + timeoutMs);

    const request: ApprovalRequest = {
      id,
      command,
      workspaceId,
      agentId,
      requesterName,
      status: ApprovalStatus.Pending,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.requests.set(id, request);

    // Set expiry timer
    const expiryTimer = setTimeout(() => {
      this.expire(id);
    }, timeoutMs);

    this.expireTimers.set(id, expiryTimer);

    return request;
  }

  /**
   * Get a request by ID.
   */
  getRequest(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  /**
   * Approve a request.
   */
  approve(id: string, approvedBy: string, reason: string): void {
    const request = this.requests.get(id);
    if (request) {
      this.requirePending(request);
      const approvedReason = this.requireReason(reason);
      request.status = ApprovalStatus.Approved;
      request.approvedBy = approvedBy;
      request.approvedAt = new Date().toISOString();
      request.approvedReason = approvedReason;
      this.clearTimer(id);
    }
  }

  /**
   * Reject a request.
   */
  reject(id: string, reason: string): void {
    const request = this.requests.get(id);
    if (request) {
      this.requirePending(request);
      const rejectedReason = this.requireReason(reason);
      request.status = ApprovalStatus.Rejected;
      request.rejectedReason = rejectedReason;
      this.clearTimer(id);
    }
  }

  /**
   * Get all pending requests.
   */
  getPending(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(r => r.status === ApprovalStatus.Pending);
  }

  /**
   * Get all requests for a workspace.
   */
  getForWorkspace(workspaceId: string): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(r => r.workspaceId === workspaceId);
  }

  /**
   * Clear expired requests.
   */
  cleanup(): void {
    const now = new Date();
    for (const [id, request] of this.requests.entries()) {
      if (new Date(request.expiresAt) < now && request.status === ApprovalStatus.Pending) {
        this.expire(id);
      }
    }
  }

  /**
   * Clear all data.
   */
  close(): void {
    for (const timer of this.expireTimers.values()) {
      clearTimeout(timer);
    }
    this.expireTimers.clear();
    this.requests.clear();
  }

  private clearTimer(id: string): void {
    const timer = this.expireTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.expireTimers.delete(id);
    }
  }

  private expire(id: string): void {
    const request = this.requests.get(id);
    if (request?.status === ApprovalStatus.Pending) {
      request.status = ApprovalStatus.Expired;
      request.rejectedReason = this.timeoutDenialReason;
    }
    this.clearTimer(id);
  }

  private requirePending(request: ApprovalRequest): void {
    if (request.status !== ApprovalStatus.Pending) {
      throw new Error("Only pending approval requests can be resolved");
    }
  }

  private resolveExpiryMs(expiryMs?: number): number {
    const timeoutMs = expiryMs ?? this.defaultExpiryMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Approval request timeout must be a positive finite number");
    }
    return timeoutMs;
  }

  private requireReason(reason: string): string {
    const normalized = reason.trim();
    if (!normalized) {
      throw new Error("Approval resolution requires an operator-supplied reason");
    }
    return normalized;
  }
}
