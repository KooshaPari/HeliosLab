/**
 * Approval Workflow Management Page
 */

import { createSignal, onMount } from "solid-js";
import { ApprovalPanel } from "../components/approval/ApprovalPanel";
import { ApprovalStatus } from "../types/approval";
import type { ApprovalRequest, ApprovalWorkflow } from "../types/approval";

export function ApprovalWorkflowPage() {
  const [requests, setRequests] = createSignal<ApprovalRequest[]>([]);
  const [workflow, setWorkflow] = createSignal<ApprovalWorkflow | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    setRequests([]);
    setWorkflow({
      userId: "current-user",
      totalRequests: 0,
      pendingRequests: 0,
      approvedRequests: 0,
      rejectedRequests: 0,
    });
    setLoading(false);
  });

  const handleApprove = (id: string) => {
    setRequests(requests().map(r => (r.id === id ? { ...r, status: ApprovalStatus.Approved } : r)));
  };

  const handleReject = (id: string, reason: string) => {
    setRequests(
      requests().map(r =>
        r.id === id ? { ...r, status: ApprovalStatus.Rejected, rejectedReason: reason } : r
      )
    );
  };

  return (
    <div class="approval-workflow-page">
      <div class="page-header">
        <h1>Command Approval Workflows</h1>
        <p>Review and manage pending approval requests</p>
      </div>

      {loading() ? (
        <div class="loading">Loading approvals...</div>
      ) : (
        <div class="workflow-container">
          {workflow() && (
            <div class="workflow-stats">
              <div class="stat">
                <span class="label">Total</span>
                <span class="value">{workflow()!.totalRequests}</span>
              </div>
              <div class="stat">
                <span class="label">Pending</span>
                <span class="value pending">{workflow()!.pendingRequests}</span>
              </div>
              <div class="stat">
                <span class="label">Approved</span>
                <span class="value approved">{workflow()!.approvedRequests}</span>
              </div>
              <div class="stat">
                <span class="label">Rejected</span>
                <span class="value rejected">{workflow()!.rejectedRequests}</span>
              </div>
            </div>
          )}

          <ApprovalPanel requests={requests()} onApprove={handleApprove} onReject={handleReject} />
        </div>
      )}

      <style>{`
        .approval-workflow-page {
          padding: 2rem;
        }
        .page-header h1 { margin: 0; font-size: 2rem; }
        .stat .value.pending { color: #ff9800; }
        .stat .value.approved { color: #28a745; }
      `}</style>
    </div>
  );
}
