# Epic Task Cards

Date: 2026-02-26
Status: Ready for assignment

## Owner Roles

- `RuntimeLead`
- `ProtocolLead`
- `UILead`
- `InfraLead`
- `PerfLead`
- `SecurityLead`

## Epic: Runtime Foundation

### Card HLS-001
- Title: Bootstrap ElectroBun shell and settings substrate
- Owner: `UILead`
- Acceptance Criteria:
1. App boots with persisted settings.
2. `rendererEngine` setting supports `ghostty` and `rio`.
3. Startup path emits health event.

### Card HLS-002
- Title: Local bus base transport and envelope validation
- Owner: `ProtocolLead`
- Acceptance Criteria:
1. Bus accepts command/response/event envelopes.
2. Invalid envelopes are rejected with standardized error.
3. Correlation IDs are preserved end-to-end.

### Card HLS-003
- Title: Workspace and project metadata persistence
- Owner: `RuntimeLead`
- Acceptance Criteria:
1. Workspaces can be created/opened/closed.
2. Project metadata persists across restarts.
3. Open workspace restoration works on boot.

## Epic: Worktree and Mux

### Card HLS-010
- Title: Integrate `par` lane lifecycle
- Owner: `RuntimeLead`
- Acceptance Criteria:
1. Lane create/attach/cleanup commands execute successfully.
2. Lane lifecycle events emit on local bus.
3. Failed lane actions surface actionable error payloads.

### Card HLS-011
- Title: Integrate `zellij` session adapter
- Owner: `RuntimeLead`
- Acceptance Criteria:
1. Session ensure/open/kill commands execute.
2. Pane creation and attach events are emitted.
3. Adapter errors are non-fatal to host runtime.

### Card HLS-012
- Title: Orphan lane/session watchdog
- Owner: `InfraLead`
- Acceptance Criteria:
1. Detect orphaned worktrees or sessions.
2. Emit warning events and remediation suggestions.
3. Optional auto-cleanup policy executes safely.

## Epic: Durability and Recovery

### Card HLS-020
- Title: Terminal registry and lifecycle table
- Owner: `RuntimeLead`
- Acceptance Criteria:
1. Terminal IDs map to lane/session/workspace IDs.
2. State transitions are validated.
3. Registry survives soft restart.

### Card HLS-021
- Title: `zmx` checkpoint and restore hooks
- Owner: `RuntimeLead`
- Acceptance Criteria:
1. Checkpoint command returns checkpoint ID.
2. Restore command recreates terminal context.
3. Failure modes emit recoverable errors.

### Card HLS-022
- Title: Crash restart recovery pipeline
- Owner: `InfraLead`
- Acceptance Criteria:
1. Crash simulation restarts runtime.
2. Lanes/sessions restore from persisted state.
3. Recovery time is recorded in metrics.

## Epic: Renderer Subsystem

### Card HLS-030
- Title: Renderer adapter interface contract
- Owner: `UILead`
- Acceptance Criteria:
1. Common adapter shape implemented for both engines.
2. Lifecycle methods (`start`, `stop`, `switch`) are defined.
3. Adapter contract emits capability matrix.

### Card HLS-031
- Title: `ghostty` renderer adapter
- Owner: `UILead`
- Acceptance Criteria:
1. Terminal render loop runs with PTY stream input.
2. Resize and input pass-through works.
3. Metrics hooks emit frame and queue stats.

### Card HLS-032
- Title: `rio` renderer adapter
- Owner: `UILead`
- Acceptance Criteria:
1. Terminal render loop runs with PTY stream input.
2. Resize and input pass-through works.
3. Metrics hooks emit frame and queue stats.

### Card HLS-033
- Title: Renderer switch transaction
- Owner: `UILead`
- Acceptance Criteria:
1. Hot swap path works where supported.
2. Restart fallback preserves sessions.
3. Rollback works on failed switch.

## Epic: Collaboration Overlays

### Card HLS-040
- Title: `upterm` share adapter
- Owner: `SecurityLead`
- Acceptance Criteria:
1. Share session starts with explicit user approval.
2. Stop/revoke works reliably.
3. TTL expiration auto-terminates share session.

### Card HLS-041
- Title: `tmate` share adapter
- Owner: `SecurityLead`
- Acceptance Criteria:
1. Share session starts with explicit user approval.
2. Stop/revoke works reliably.
3. TTL expiration auto-terminates share session.

### Card HLS-042
- Title: Share session UX and audit trail
- Owner: `UILead`
- Acceptance Criteria:
1. Share status visible by terminal.
2. Revoke action available in one interaction.
3. Audit event records start/stop actor and timestamps.

## Epic: Protocol Boundaries

### Card HLS-050
- Title: ACP client boundary adapter
- Owner: `ProtocolLead`
- Acceptance Criteria:
1. ACP task run/cancel integrates with runtime events.
2. Adapter failures map to standard error envelope.
3. Correlation and audit fields preserved.

### Card HLS-051
- Title: MCP tool bridge
- Owner: `ProtocolLead`
- Acceptance Criteria:
1. Tool call requests route through MCP adapter.
2. Results and failures are emitted as runtime events.
3. Tool args are redacted in audit output.

### Card HLS-052
- Title: A2A federation adapter
- Owner: `ProtocolLead`
- Acceptance Criteria:
1. Delegation requests map to external A2A calls.
2. Completion/failure maps to `agent.run.*` events.
3. External failures do not block local runtime.

## Epic: Policy and Safety

### Card HLS-060
- Title: Policy evaluation engine
- Owner: `SecurityLead`
- Acceptance Criteria:
1. Command/share/agent actions evaluated before execution.
2. Deny decisions include rule reason.
3. Allow decisions include policy decision ID.

### Card HLS-061
- Title: Audit sink and export bundle
- Owner: `InfraLead`
- Acceptance Criteria:
1. Append-only event log is persisted.
2. Search by workspace/session/correlation ID works.
3. Session export bundle includes timeline and outcomes.

### Card HLS-062
- Title: Redaction and sensitive path protections
- Owner: `SecurityLead`
- Acceptance Criteria:
1. Secret patterns are redacted in logs.
2. Protected path rules block unauthorized actions.
3. Violations surface clear denial feedback.

## Epic: Performance and Reliability

### Card HLS-070
- Title: Runtime memory accounting
- Owner: `PerfLead`
- Acceptance Criteria:
1. Memory metrics are sampled and emitted.
2. Per-lane and per-terminal attribution available.
3. Alerts fire when thresholds exceed policy.

### Card HLS-071
- Title: 25-terminal soak harness
- Owner: `PerfLead`
- Acceptance Criteria:
1. Harness can create and sustain 25 terminals.
2. Latency/fps/memory metrics captured.
3. Summary report generated per run.

### Card HLS-072
- Title: Worktree swarm stress harness
- Owner: `PerfLead`
- Acceptance Criteria:
1. `par` lane churn stress scenario runs reproducibly.
2. `zellij` and `zmx` recovery paths exercised.
3. Failure artifacts captured for triage.
