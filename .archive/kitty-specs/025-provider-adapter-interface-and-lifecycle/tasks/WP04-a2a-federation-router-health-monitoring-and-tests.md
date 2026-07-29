---
work_package_id: WP04
title: A2A Federation Router, Health Monitoring, and Tests
lane: "done"
dependencies:
- WP01
- WP02
- WP03
base_branch: 025-provider-adapter-interface-and-lifecycle-WP04-merge-base
base_commit: 0a04f49a119debb9ec9c46a7d93bb886636b4050
created_at: '2026-03-01T13:35:47.784430+00:00'
subtasks:
- T016
- T017
- T018
- T019
- T020
phase: Phase 2 - Federation and Hardening
assignee: ''
agent: "claude-haiku"
shell_pid: "81218"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP04 - A2A Federation Router, Health Monitoring, and Tests

## Objectives & Success Criteria

- Implement the A2A federation router stub with endpoint registration, delegation routing, and failure isolation.
- Deliver a cross-provider health monitoring coordinator that manages health state for all registered providers.
- Implement failover routing that reroutes traffic from degraded providers to healthy alternatives.
- Deliver chaos tests proving provider crash isolation across lanes (SC-025-002).
- Deliver integration tests for A2A delegation, failover, credential rotation, and normalized error completeness.

Success criteria:
- A2A stub routes delegation to mock endpoint with correlation ID propagation and failure isolation.
- Health coordinator tracks all providers and publishes state transitions on bus.
- Failover routes to healthy provider within one health check interval.
- Provider crash in lane A produces zero observable effect on lane B in 100% of chaos runs.
- All provider errors map to normalized taxonomy with zero unmapped codes (SC-025-004).
- Credential rotation takes effect without restart or task interruption (SC-025-005).

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/025-provider-adapter-interface-and-lifecycle/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/025-provider-adapter-interface-and-lifecycle/spec.md`
- WP01-WP03 outputs:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/adapter.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/registry.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/errors.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/acp-client.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/mcp-bridge.ts`

Constraints:
- A2A router is slice-1 stub; full multi-endpoint failover deferred to slice-2.
- Failover is provider-level, not request-level.
- Health monitoring interval default 30s, minimum 5s.
- Coverage >=85% with FR-025-005, FR-025-009, FR-025-010 traceability.

Implementation command:
- `spec-kitty implement WP04`

## Subtasks & Detailed Guidance

### Subtask T016 - Implement A2A federation router stub

- Purpose: Establish the A2A delegation boundary for external agent collaboration.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/a2a-router.ts`.
  2. Implement `A2ARouterAdapter` class implementing `ProviderAdapter<A2AConfig, A2ADelegation, A2AResult>`.
  3. Define `A2AConfig` type: `endpoints: A2AEndpoint[]`, `timeoutMs: number`, `failoverEnabled: boolean`.
  4. Define `A2AEndpoint` type: `id: string`, `url: string`, `priority: number`, `capabilities: string[]`.
  5. Define `A2ADelegation` type: `taskDescription: string`, `requiredCapabilities: string[]`, `context: Record<string, unknown>`.
  6. Define `A2AResult` type: `endpointId: string`, `result: unknown`, `correlationId: string`, `duration: number`.
  7. Implement `init(config: A2AConfig)`:
     - Validate endpoint configurations.
     - Perform initial health probes on all endpoints.
     - Build routing table sorted by priority.
  8. Implement `execute(input: A2ADelegation, correlationId: string)`:
     - Select endpoint by matching capabilities and priority.
     - Send delegation request with correlation ID.
     - Capture result and sync to local bus.
     - On failure, isolate to originating lane; do not propagate to other lanes.
  9. Implement `terminate()`:
     - Cancel in-flight delegations.
     - Clear routing table.
  10. Mark slice-2 features with explicit TODO comments: multi-endpoint failover, dynamic endpoint discovery.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/a2a-router.ts`
- Validation:
  - A2A stub routes delegation to mock endpoint with correlation.
  - Failure isolates to originating lane.
  - Slice-2 TODOs are explicit and documented.
- Parallel: No.

### Subtask T017 - Implement cross-provider health monitoring coordinator

- Purpose: Centralize health tracking for all registered providers across ACP, MCP, and A2A.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/health.ts`.
  2. Implement `HealthCoordinator` class:
     - `register(providerId: string, adapter: ProviderAdapter, intervalMs: number)` -- start periodic health checks.
     - `unregister(providerId: string)` -- stop health checks and remove from tracking.
     - `getStatus(providerId: string): ProviderHealthStatus` -- current status.
     - `getAllStatuses(): Map<string, ProviderHealthStatus>` -- all provider statuses.
     - `getHealthyProviders(type: string): string[]` -- provider IDs in healthy state by type.
  3. Implement health check loop per provider:
     - Call `adapter.health()` at configured interval.
     - Track consecutive failures: 3 -> degraded, recovery threshold configurable.
     - On state transition, publish `provider.health.changed` bus event with provider ID, type, old/new state.
  4. Implement degraded provider handling:
     - Degraded providers remain registered but excluded from active routing.
     - Recovery check continues at same interval; single success restores to healthy.
  5. Implement all-unhealthy detection:
     - When all providers for a capability type are unhealthy, publish `provider.capability.unavailable` alert.
     - Tasks dispatched to unavailable capability are queued (up to configurable limit) rather than failed.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/health.ts`
- Validation:
  - Health checks run at configured intervals for all registered providers.
  - State transitions are deterministic and bus-published.
  - Degraded providers are excluded from routing queries.
  - All-unhealthy triggers alert and task queuing.
- Parallel: No.

### Subtask T018 - Implement failover routing logic

- Purpose: Reroute traffic from degraded providers to healthy alternatives.
- Steps:
  1. In `health.ts` or new `failover.ts`, implement `FailoverRouter`:
     - `selectProvider(type: string, requiredCapabilities?: string[]): string | null` -- returns healthy provider ID or null.
     - Selection strategy: priority-weighted among healthy providers of the requested type.
     - If primary (highest priority) is degraded, select next healthy provider.
     - If all are unhealthy, return null (caller handles queuing or error).
  2. Integrate `FailoverRouter` with registry:
     - Registry's `execute` path uses `FailoverRouter.selectProvider()` instead of direct provider lookup.
     - Failover selection is logged as bus event: `provider.failover.activated` with from/to provider IDs.
  3. Implement routing table update on health state changes:
     - Health coordinator notifies failover router on state transitions.
     - Routing table is recalculated on each transition (not on each request).
  4. Ensure failover is provider-level: in-flight requests to a crashing provider may fail (not retried automatically).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/health.ts` (or new `failover.ts`)
- Validation:
  - Failover selects healthy provider when primary is degraded.
  - Failover event is published on bus.
  - Routing table updates on health transitions, not on each request.
  - No implicit retry of in-flight requests.
- Parallel: No.

### Subtask T019 - Add chaos tests for provider crash isolation

- Purpose: Prove that provider crash in one lane has zero effect on another lane (SC-025-002).
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/chaos.test.ts`.
  2. Test scenario: **Cross-lane crash isolation**:
     - Register provider A in lane-1 and provider B in lane-2, both using process isolation.
     - Start concurrent execute calls on both providers.
     - Kill provider A's child process mid-execution (simulate crash).
     - Verify: provider A returns normalized `PROVIDER_CRASHED` error.
     - Verify: provider B completes successfully with correct result.
     - Verify: no resource leaks (orphan processes, open FDs) from provider A's crash.
     - Verify: lane-2 health status remains healthy.
  3. Test scenario: **Rapid successive crashes**:
     - Crash provider A 5 times in quick succession.
     - Verify: each crash produces normalized error.
     - Verify: no host process instability.
     - Verify: health coordinator transitions A to unavailable.
  4. Test scenario: **Crash during health check**:
     - Kill provider mid-health-check.
     - Verify: health check returns degraded/unavailable, does not hang.
  5. Run each scenario at least 10 times to verify 100% isolation rate.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/chaos.test.ts`
- Validation:
  - 100% crash isolation across 10+ runs per scenario.
  - Zero orphan processes after each test.
  - SC-025-002 fully covered.
- Parallel: Yes (after T016/T017/T018 are stable).

### Subtask T020 - Add integration tests for A2A, failover, credential rotation, and error completeness

- Purpose: Comprehensive integration tests for remaining success criteria.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/integration.test.ts`.
  2. **A2A delegation tests**:
     - Mock A2A endpoint receives delegation with correlation ID.
     - Delegation failure isolates to originating lane.
     - Bus events emitted for delegation success and failure.
  3. **Failover routing tests** (SC-025-003):
     - Register primary and secondary providers.
     - Degrade primary via failed health checks.
     - Verify traffic routes to secondary within one health check interval.
     - Recover primary; verify traffic returns to primary.
  4. **Credential rotation tests** (SC-025-005):
     - Register provider with credential ref.
     - Rotate credential in store.
     - Verify next execute call uses new credential without provider restart.
     - Verify no task interruption during rotation.
  5. **Normalized error completeness tests** (SC-025-004):
     - Enumerate all known error scenarios across ACP, MCP, A2A.
     - Trigger each scenario.
     - Verify every error maps to a specific normalized code (not PROVIDER_UNKNOWN).
     - Verify retryable flags are correct.
  6. **End-to-end provider lifecycle test** (SC-025-001):
     - Register ACP provider and MCP tool server.
     - Both pass health checks.
     - Execute tasks end-to-end.
     - Verify results on bus with correlation IDs.
  7. Map all tests to success criteria SC-025-001 through SC-025-005.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/integration.test.ts`
- Validation:
  - All test scenarios pass.
  - Each SC-025-* has at least one mapped test.
  - Coverage across all provider files >=85%.
- Parallel: Yes (after T016/T017/T018 are stable).

## Test Strategy

- Chaos tests use real child processes with intentional crash injection.
- Failover tests use mock providers with configurable health responses.
- Credential rotation tests use mock credential store with rotation API.
- Error completeness tests enumerate all error paths systematically.
- All tests run via Bun/Vitest.

## Risks & Mitigations

- Risk: Chaos tests are flaky due to timing-dependent process kills.
- Mitigation: Use deterministic kill signals and wait for confirmed exit before assertions.
- Risk: Failover routing introduces subtle ordering bugs.
- Mitigation: Routing table is sorted deterministically; no randomization in provider selection.

## Review Guidance

- Confirm A2A stub has explicit slice-2 TODOs for deferred features.
- Confirm health coordinator manages all provider types uniformly.
- Confirm failover routing is provider-level with explicit bus events.
- Confirm chaos tests achieve 100% isolation across multiple runs.
- Confirm error taxonomy has zero unmapped codes.
- Confirm credential rotation works without restart.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:35:48Z – claude-haiku – shell_pid=81218 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:37:00Z – claude-haiku – shell_pid=81218 – lane=done – Implemented: A2A router, health monitoring, and failover with tests
