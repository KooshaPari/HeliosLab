/**
 * Approval Request Panel UI Component
 * Displays pending approval requests and handles approval/rejection.
 */

import { createSignal, For } from "solid-js";
import type { ApprovalRequest } from "../../types/approval";

interface ApprovalPanelProps {
  requests: ApprovalRequest[];
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}

export function ApprovalPanel(props: ApprovalPanelProps) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [rejectReason, setRejectReason] = createSignal("");

  const selectedRequest = () => {
    const id = selectedId();
    return id ? props.requests.find(r => r.id === id) : null;
  };

  const handleApprove = (id: string) => {
    props.onApprove(id);
    setSelectedId(null);
  };

  const handleReject = () => {
    const id = selectedId();
    if (id && rejectReason()) {
      props.onReject(id, rejectReason());
      setSelectedId(null);
      setRejectReason("");
    }
  };

  return (
    <div class="approval-panel">
      <h2>Pending Approvals ({props.requests.length})</h2>

      {props.requests.length === 0 ? (
        <p class="empty-state">No pending approval requests</p>
      ) : (
        <div class="requests-list">
          <For each={props.requests}>
            {request => (
              <div
                class={`request-item ${selectedId() === request.id ? "selected" : ""}`}
                onclick={() => setSelectedId(request.id)}
              >
                <div class="request-header">
                  <code class="command">{request.command}</code>
                  <span class="agent">{request.agentId}</span>
                </div>
                <div class="request-meta">
                  <span>{request.requesterName}</span>
                  <span class="time">{new Date(request.createdAt).toLocaleString()}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      )}

      {selectedRequest() && (
        <div class="approval-details">
          <h3>Review Request</h3>
          <div class="detail-group">
            <span aria-label="Command">Command:</span>
            <code>{selectedRequest()?.command}</code>
          </div>
          <div class="detail-group">
            <span aria-label="Requested by">Requested by:</span>
            <span>{selectedRequest()?.requesterName}</span>
          </div>
          <div class="detail-group">
            <span aria-label="Workspace">Workspace:</span>
            <span>{selectedRequest()?.workspaceId}</span>
          </div>

          <div class="approval-actions">
            <button class="approve-btn" onclick={() => handleApprove(selectedRequest()?.id ?? "")}>
              Approve
            </button>
            <button type="button" class="reject-btn" onclick={() => setRejectReason("focused")}>
              Reject
            </button>
          </div>

          {rejectReason() === "focused" && (
            <div class="reject-form">
              <textarea
                placeholder="Reason for rejection..."
                value={rejectReason()}
                oninput={e => setRejectReason(e.currentTarget.value)}
              />
              <div class="reject-actions">
                <button type="button" onclick={handleReject}>
                  Confirm Reject
                </button>
                <button type="button" onclick={() => setRejectReason("")}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        .approval-panel {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
          background: #f5f5f5;
          border-radius: 8px;
        }

        .requests-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-height: 300px;
          overflow-y: auto;
        }

        .request-item {
          padding: 0.75rem;
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .request-item:hover {
          border-color: #0066cc;
          background: #f0f7ff;
        }

        .request-item.selected {
          border-color: #0066cc;
          background: #e6f2ff;
          font-weight: 500;
        }

        .command {
          font-family: monospace;
          font-size: 0.9em;
          background: #f0f0f0;
          padding: 0.25rem 0.5rem;
          border-radius: 3px;
        }

        .approval-details {
          padding: 1rem;
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        .detail-group {
          margin-bottom: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .approval-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 1rem;
        }

        button {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s;
        }

        .approve-btn {
          background: #28a745;
          color: white;
        }

        .approve-btn:hover {
          background: #218838;
        }

        .reject-btn {
          background: #dc3545;
          color: white;
        }

        .reject-btn:hover {
          background: #c82333;
        }

        .reject-form {
          margin-top: 1rem;
          padding: 0.75rem;
          background: #fff3cd;
          border-radius: 4px;
        }

        textarea {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-family: inherit;
          min-height: 80px;
          resize: vertical;
        }

        .reject-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.5rem;
        }

        .empty-state {
          text-align: center;
          color: #666;
          padding: 2rem;
        }
      `}</style>
    </div>
  );
}
