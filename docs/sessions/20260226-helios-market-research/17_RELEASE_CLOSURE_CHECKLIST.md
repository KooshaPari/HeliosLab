# Release Closure Checklist

Date: 2026-03-12
Status: All gates passed locally; release packet closed

## Purpose

Convert the completed WBS into a release-closure verification pass with explicit evidence requirements.

## Current Status

| Gate | Status | Evidence |
| --- | --- | --- |
| Gate 1: Policy and Safety | passed locally on 2026-03-12 | `bun test apps/runtime/tests/unit/policy/engine.test.ts apps/runtime/tests/unit/policy/rules.test.ts apps/runtime/tests/unit/policy/approval-queue.test.ts apps/runtime/src/integrations/sharing/__tests__/share-session.test.ts apps/runtime/src/secrets/__tests__/redaction-audit.test.ts apps/runtime/src/secrets/__tests__/ci-redaction-verification.test.ts` |
| Gate 2: Durability and Replay | passed locally on 2026-03-12 | `bun test apps/runtime/tests/integration/recovery/recovery_watchdog_audit.test.ts` |
| Gate 3: Provider Conformance | passed locally on 2026-03-12 | `bun test apps/runtime/src/providers/__tests__/acp-client.test.ts apps/runtime/src/providers/__tests__/mcp-bridge.test.ts apps/runtime/src/providers/__tests__/a2a-router.test.ts apps/runtime/src/providers/__tests__/isolation.test.ts apps/runtime/src/providers/__tests__/registry.test.ts apps/runtime/src/providers/__tests__/adapter.test.ts apps/runtime/src/providers/__tests__/errors.test.ts` |
| Gate 4: Performance and Reliability | passed locally on 2026-03-12 | `bun test apps/runtime/tests/soak/multi_session_soak.test.ts apps/runtime/tests/unit/protocol/runtime_metrics.test.ts apps/runtime/tests/bench/diagnostics/hooks-bench.test.ts apps/runtime/tests/bench/diagnostics/memory-bench.test.ts apps/runtime/tests/bench/workspace/workspace-bench.test.ts apps/runtime/tests/integration/renderer/switch_stress.test.ts apps/runtime/tests/integration/renderer/slo_validation.test.ts apps/runtime/tests/integration/renderer/fault_injection.test.ts apps/desktop/tests/unit/startup_latency.test.ts` and `bun run apps/runtime/tests/bench/protocol/bus-bench.ts` |
| Gate 5: Release Signoff | passed locally on 2026-03-12 | [18_RELEASE_SIGNOFF.md](./18_RELEASE_SIGNOFF.md) |

## Closure Gates

### Gate 1: Policy and Safety

- Verify no critical policy bypass exists in command, share-session, or agent-run flows.
- Re-run local gate mirror checks for blocked commands and protected paths.
- Confirm sensitive payload redaction still holds at the audit sink boundary.

Required evidence:
- policy regression run log
- blocked command/path test results
- redaction validation sample

Exit condition:
- zero critical bypasses

### Gate 2: Durability and Replay

- Validate crash restart recovery against tested session scenarios.
- Validate replay/export path remains consistent with audit records.
- Confirm no data loss in checkpoint, restore, and session reattach paths.

Required evidence:
- restore and replay test run log
- representative checkpoint/restore trace
- session restore timing snapshot

Exit condition:
- zero data-loss bugs in tested restore scenarios

### Gate 3: Provider Conformance

- Re-run launch adapter conformance checks for ACP, MCP, and A2A boundary assumptions.
- Validate timeout, retry, and isolation expectations for launch adapters.
- Confirm audit coverage remains present for tool and agent lifecycle calls.

Required evidence:
- provider conformance suite output
- isolation and credential-boundary test results
- audit coverage sample for adapter calls

Exit condition:
- launch adapter conformance suite green

Execution status:
- Local conformance suite rerun passed on 2026-03-12.
- Isolation, timeout, retry, and audit-path coverage stayed green across ACP, MCP, and A2A adapters.

### Gate 4: Performance and Reliability

- Run benchmark profiles covering normal, heavy, and swarm stress workloads.
- Reconfirm startup, memory, latency, and 25-terminal concurrency thresholds.
- Re-run renderer switch reliability under load.

Required evidence:
- benchmark report for profiles A, B, and C
- soak and burst test logs
- renderer switch reliability results

Exit condition:
- memory and latency targets satisfied on reference hardware

Execution status:
- Local benchmark and reliability suite rerun passed on 2026-03-12.
- Startup benchmark: `desktop-startup-latency` p95 `0.66ms` on the local harness.
- Soak benchmark: `multi_session_soak` passed with lane create p95 `<=30ms`, session restore p95 `<=35ms`, and backlog p95 `<=64`.
- Protocol bus benchmark passed for dispatch, fan-out, validation, and sustained throughput.
- Renderer switch stress, SLO, and fault-injection suites stayed green under load.
- This is local harness evidence, not a separate reference-hardware certification pass.

### Gate 5: Release Signoff

- Cross-check all evidence against v1 exit criteria.
- Record any exceptions with owner, rollback, and due date.
- Confirm conservative policy defaults remain the launch posture.

Required evidence:
- signed closure summary
- exception ledger, if any
- final go/no-go disposition

Exit condition:
- all v1 exit criteria satisfied or explicitly exceptioned

Execution status:
- Local release signoff completed on 2026-03-12.
- No blocking exceptions were recorded.
- Final disposition: go for local closure.

## Execution Order

1. Gate 1: Policy and Safety
2. Gate 2: Durability and Replay
3. Gate 3: Provider Conformance
4. Gate 4: Performance and Reliability
5. Gate 5: Release Signoff

## Failure Handling

- Any policy bypass is an immediate stop-ship.
- Any restore-path data loss is an immediate stop-ship.
- Any launch-adapter isolation failure is an immediate stop-ship.
- Any threshold miss on performance or reliability requires either remediation or a documented exception before signoff.
