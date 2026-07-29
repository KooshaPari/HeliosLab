# Testing Strategy

## Test Objectives

- Validate terminal responsiveness and stability at concurrency target.
- Validate policy enforcement and command safety invariants.
- Validate provider adapter correctness and isolation.
- Validate session replay, crash recovery, and audit integrity.

## Test Layers

### Unit
- Policy evaluator decisions.
- Provider adapter request/response normalization.
- Session state reducers and persistence codecs.

### Integration
- PTY + mux adapter lifecycle.
- Provider runner orchestration and timeout/retry behavior.
- MCP bridge calls and permission boundaries.

### End-to-End
- New project flow (clone/init/open).
- New chat flow with provider selection.
- Freehand terminal parity under heavy load.
- AI-assisted apply/rollback path with audit trail.

## Performance and Reliability

- Soak tests: 25 active terminals for extended sessions.
- Burst tests: high-output command streams.
- Startup latency tests.
- Memory ceiling tests with representative workload profiles.

## Security Tests

- Blocked command/path policy enforcement.
- Secrets redaction validation in logs and UI.
- Provider credential isolation and leakage tests.

## Release Closure Verification Queue

### Queue 1: Policy and Safety

- Re-run blocked command and protected-path enforcement checks.
- Re-run share-session approval gate checks for `upterm` and `tmate`.
- Re-run audit redaction validation against representative sensitive payloads.

Evidence:
- policy regression log
- approval gate test results
- redaction verification sample

### Queue 2: Durability and Replay

- Re-run crash recovery scenarios covering checkpoint, restart, restore, and reattach.
- Verify session replay export remains aligned with stored audit events.
- Capture restore timing and any orphan reconciliation behavior.

Evidence:
- restore/replay test log
- replay export sample
- restore timing report

### Queue 3: Provider Conformance

- Re-run launch-provider adapter conformance checks.
- Verify timeout, retry, and isolation behaviors across adapter boundaries.
- Verify audit events for MCP and A2A mediated calls.

Evidence:
- provider conformance output
- isolation test output
- audit event coverage sample

### Queue 4: Performance and Reliability

- Run benchmark Profile A as smoke, Profile B as stress, and Profile C as soak.
- Re-run burst-output and renderer-switch-under-load scenarios.
- Reconfirm startup, latency, memory, and 25-terminal concurrency thresholds.

Evidence:
- benchmark profile reports
- soak and burst logs
- renderer switch reliability report

## Exit Criteria for v1

- 0 critical policy bypasses.
- 0 data-loss bugs in session restore for tested scenarios.
- Memory and latency metrics hit agreed thresholds on reference hardware.
- Provider adapter conformance suite green for launch providers.
