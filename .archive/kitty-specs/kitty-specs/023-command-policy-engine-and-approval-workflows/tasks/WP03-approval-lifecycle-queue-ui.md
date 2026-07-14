---
work_package_id: WP03
title: Approval Request Lifecycle, Queue UI, and Tests
lane: "done"
dependencies:
- WP02
base_branch: 023-command-policy-engine-and-approval-workflows-WP02
base_commit: 3d114b8bc8038f4a7e78d7d66b23df7e0c498825
created_at: '2026-03-01T13:36:10.511811+00:00'
subtasks:
- T011
- T012
- T013
- T014
- T015
- T016
- T017
phase: Phase 2 - Approval Workflows
assignee: ''
agent: "claude-haiku"
shell_pid: "82086"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP03 - Approval Request Lifecycle, Queue UI, and Tests

## Objectives & Success Criteria

- Implement the full approval request lifecycle: create, queue, approve/deny/timeout.
- Deliver a durable SQLite-backed queue that survives process restarts.
- Deliver an approval queue UI panel in the desktop shell.
- Validate queue durability with chaos tests.

Success criteria:
- Approval requests survive simulated crash and restart with zero loss.
- Approval round-trip (request creation to command execution after approval) < 500ms excluding operator decision time.
- Queue supports 100+ concurrent pending requests.
- UI panel shows pending requests with full context and approve/deny controls.
- Audit trail records every approval action.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/023-command-policy-engine-and-approval-workflows/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/023-command-policy-engine-and-approval-workflows/spec.md`
- WP02 output: PolicyEvaluationEngine integrated into lane/terminal execution.

Constraints:
- Queue must be SQLite-backed for durability across restarts.
- Concurrent requests must not deadlock.
- Timeout default action is deny.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP03`

## Subtasks & Detailed Guidance

### Subtask T011 - Implement ApprovalRequest model

- Purpose: Define the data model for approval requests with full command context.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/approval.ts`.
  2. Define `ApprovalRequestStatus` enum: `"pending"`, `"approved"`, `"denied"`, `"timed-out"`.
  3. Define `ApprovalRequest` interface:
     - `id`: unique string (UUID)
     - `commandText`: string (the command awaiting approval)
     - `affectedPaths`: array of file paths the command will affect
     - `riskClassification`: string (from policy evaluation)
     - `agentRationale`: string (why the agent wants to run this command)
     - `matchedRuleId`: string (the policy rule that triggered the approval requirement)
     - `status`: ApprovalRequestStatus
     - `operatorReason`: optional string (provided on approve or deny)
     - `workspaceId`, `laneId`, `sessionId`: context IDs
     - `correlationId`: string (links to the originating command)
     - `createdAt`: ISO 8601 timestamp
     - `resolvedAt`: optional ISO 8601 timestamp
     - `timeoutAt`: ISO 8601 timestamp (when the request expires)
     - `timeoutAction`: `"deny"` | `"approve"` (configurable, default deny)
  4. Define `ApprovalAction` type: `{ type: "approve" | "deny", operatorReason: string }`.
  5. Export all types.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/approval.ts`
- Acceptance:
  - All fields documented with JSDoc.
  - Types are complete for the full lifecycle.
  - Timeout action is configurable.
- Parallel: No.

### Subtask T012 - Implement durable SQLite ApprovalQueue

- Purpose: Store pending approval requests in SQLite so they survive process restart and support concurrent access.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/queue.ts`.
  2. Use `bun:sqlite` for the database connection.
  3. Create table schema: `approval_requests` with columns matching the `ApprovalRequest` interface.
  4. Implement `enqueue(request: ApprovalRequest)`: insert into SQLite and publish `approval.request.created` on the bus.
  5. Implement `dequeue(id: string, action: ApprovalAction)`: update status, set resolvedAt, publish `approval.request.resolved` event.
  6. Implement `getPending(workspaceId?)`: query all pending requests, ordered by createdAt.
  7. Implement `getExpired()`: query requests where `timeoutAt < now()` and status is still pending.
  8. Enable WAL mode for SQLite to support concurrent reads/writes.
  9. Add database migration logic: create table on first run.
  10. Handle edge cases: duplicate enqueue (idempotent via unique ID), dequeue of already-resolved request (no-op with warning).
  11. Test: enqueue a request, kill the process, restart, verify the request is still pending.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/queue.ts`
- Acceptance:
  - Requests persist in SQLite across restarts.
  - Concurrent access works without deadlocks (WAL mode).
  - Bus events published on enqueue and resolve.
  - Supports 100+ concurrent pending requests.
- Parallel: No.

### Subtask T013 - Implement approve/deny/timeout actions

- Purpose: Handle the operator's decision on pending approval requests and apply the result.
- Steps:
  1. In `queue.ts` or a dedicated `approval-handler.ts`, implement action handling:
     - `approve(requestId, operatorReason)`: update request status to approved, set resolvedAt, store reason.
     - `deny(requestId, operatorReason)`: update status to denied, set resolvedAt, store reason.
     - `processTimeouts()`: scan for expired requests, apply the configured timeout action (deny or approve), update status.
  2. On approve: emit `approval.command.approved` event with the request details and command.
  3. On deny: emit `approval.command.denied` event with details and reason.
  4. On timeout: emit `approval.command.timed-out` event.
  5. Write audit events for every action via the audit sink.
  6. Run `processTimeouts()` on a periodic timer (e.g., every 5 seconds).
  7. Handle edge cases: approve/deny of already-resolved request (return error, do not double-process).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/queue.ts` (or new handler file)
- Acceptance:
  - Approve/deny/timeout correctly update request status.
  - Bus events emitted for each action.
  - Audit trail for every action.
  - Timeout processing runs periodically.
- Parallel: No.

### Subtask T014 - Implement approval queue UI panel

- Purpose: Give operators visibility into pending approval requests and controls to approve or deny.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/approval-queue.ts`.
  2. The panel must display a list of pending approval requests with:
     - Command text (syntax highlighted if possible)
     - Affected paths
     - Risk classification (color-coded: green/yellow/red)
     - Agent rationale
     - Time remaining until timeout
     - Approve button with reason input
     - Deny button with reason input
  3. Subscribe to bus events (`approval.request.created`, `approval.request.resolved`) for real-time updates.
  4. When the operator clicks approve or deny, call the runtime API to resolve the request.
  5. Show resolved requests (last 10) in a collapsed history section.
  6. Add a badge/indicator in the shell sidebar showing the count of pending approvals.
  7. Handle empty state: "No pending approval requests" message.
  8. Ensure the panel is responsive and does not block the main UI thread.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/panels/approval-queue.ts`
- Acceptance:
  - Pending requests displayed with full context.
  - Approve/deny actions work from the UI.
  - Real-time updates via bus subscription.
  - Badge shows pending count.
- Parallel: No.

### Subtask T015 - Wire approved commands to immediate execution

- Purpose: Ensure that once an operator approves a command, execution resumes within 500ms.
- Steps:
  1. In the lane execution integration (T007) and terminal dispatch integration (T008), implement the suspension-and-resume flow:
     - When a command is classified as `needs-approval`, create an ApprovalRequest and suspend execution.
     - Subscribe to the `approval.command.approved` event for the specific request ID.
     - On approval: resume command execution immediately.
     - On denial: return a denial error to the agent with the operator's reason.
     - On timeout: apply timeout action (deny by default) and return appropriate error.
  2. Measure the round-trip time from approval event to command execution start.
  3. Optimize the event propagation path to minimize latency.
  4. Test: approve a pending request, verify execution starts within 500ms.
  5. Test: deny a pending request, verify the agent receives the denial reason.
  6. Test: let a request timeout, verify the timeout action is applied.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/exec.ts` (or equivalent)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/sessions/` (terminal dispatch)
- Acceptance:
  - Approval-to-execution latency < 500ms.
  - Denial returns structured error to agent.
  - Timeout action applied correctly.
- Parallel: No.

### Subtask T016 - Queue durability chaos tests

- Purpose: Prove that the approval queue survives crashes with zero request loss.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/policy/queue-chaos.test.ts`.
  2. Test: enqueue 10 requests, simulate process kill (SIGKILL equivalent), restart, verify all 10 are still pending.
  3. Test: enqueue 50 requests concurrently from multiple lanes, verify all 50 are persisted without duplicates or losses.
  4. Test: enqueue and immediately approve in rapid succession, verify no race conditions between enqueue and resolve.
  5. Test: fill queue to 100+ requests, verify no degradation in enqueue/dequeue performance.
  6. Test: corrupt the SQLite database file, verify the queue handles it gracefully (error message, not crash).
  7. Use actual SQLite operations (not mocked) for realistic chaos testing.
  8. Verify via audit trail that every request has a corresponding create event and (if resolved) a resolve event.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/policy/queue-chaos.test.ts`
- Acceptance:
  - Zero request loss across all crash scenarios.
  - Concurrent access handled correctly.
  - Graceful handling of database corruption.
- Parallel: Yes (after T011-T015 are functional).

### Subtask T017 - Approval lifecycle integration tests

- Purpose: Validate the complete approval workflow from request creation through command execution or denial.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/policy/approval-lifecycle.test.ts`.
  2. Test: full approve flow: agent issues command -> policy evaluates as needs-approval -> request created -> operator approves -> command executes -> audit trail complete.
  3. Test: full deny flow: agent issues command -> policy evaluates as needs-approval -> request created -> operator denies -> agent receives denial -> audit trail complete.
  4. Test: timeout flow: request created -> timeout expires -> default deny action applied -> agent receives timeout error -> audit trail complete.
  5. Test: concurrent approvals: multiple lanes create requests simultaneously, each resolved independently.
  6. Test: direct operator command bypasses approval but produces audit entry.
  7. Test: audit trail contains events for every stage of the lifecycle.
  8. Test: UI panel reflects state changes in real time (subscribe to bus events and verify).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/policy/approval-lifecycle.test.ts`
- Acceptance:
  - All lifecycle flows tested end-to-end.
  - Audit trail complete for every scenario.
  - Concurrent flows handled correctly.
- Parallel: Yes (after T011-T015 are functional).

## Test Strategy

- Chaos tests with actual SQLite for queue durability.
- Integration tests for full approval lifecycle.
- Performance measurements for approval round-trip.
- Concurrent access tests for deadlock prevention.

## Risks & Mitigations

- Risk: SQLite write contention under concurrent approvals.
- Mitigation: WAL mode; benchmark; serialize writes if needed.
- Risk: Approval UI becomes unresponsive with many pending requests.
- Mitigation: Paginate the queue display; lazy-load request details.

## Review Guidance

- Confirm queue survives crash with zero loss.
- Confirm approval round-trip < 500ms.
- Confirm timeout default is deny.
- Confirm UI shows all required context fields.
- Confirm audit trail is complete for all lifecycle stages.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:36:10Z – claude-haiku – shell_pid=82086 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:36:53Z – claude-haiku – shell_pid=82086 – lane=done – Implemented
