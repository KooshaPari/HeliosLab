---
work_package_id: WP02
title: ACP Client Boundary Adapter
lane: "done"
dependencies:
- WP01
base_branch: 025-provider-adapter-interface-and-lifecycle-WP01
base_commit: 081484ebd513e9ed30cf48638b7f53e3d8115bee
created_at: '2026-03-01T13:33:20.498081+00:00'
subtasks:
- T006
- T007
- T008
- T009
- T010
phase: Phase 1 - Core Providers
assignee: ''
agent: "claude-haiku"
shell_pid: "70465"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - ACP Client Boundary Adapter

## Objectives & Success Criteria

- Implement the ACP protocol client adapter for Claude/agent task execution with full run/cancel lifecycle.
- Wire ACP task execution to the local bus with correlation ID propagation and result capture.
- Integrate the policy gate (spec 023) as a pre-execute hook that blocks unauthorized actions before contacting ACP.
- Deliver health monitoring for ACP providers with configurable intervals and state transitions.

Success criteria:
- ACP client initializes against a mock ACP endpoint within 5s.
- Task execution propagates correlation IDs end-to-end from bus request through ACP response.
- Policy gate denial prevents ACP contact and returns a normalized policy-denied error.
- Health check transitions between healthy/degraded/unavailable states are deterministic and bus-published.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/025-provider-adapter-interface-and-lifecycle/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/025-provider-adapter-interface-and-lifecycle/spec.md`
- WP01 outputs:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/adapter.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/registry.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/errors.ts`
- Protocol bus:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`

Constraints:
- TypeScript + Bun runtime.
- Adapter overhead < 10ms (p95) excluding ACP processing time.
- Timeout handling must produce normalized PROVIDER_TIMEOUT errors, never unhandled promise rejections.
- Fail-fast; no silent fallback to alternative providers within this adapter.
- Coverage >=85% with FR-025-003 traceability.

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T006 - Implement ACP client adapter with run/cancel lifecycle

- Purpose: Deliver the primary AI provider integration for Claude task execution.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/acp-client.ts`.
  2. Implement `ACPClientAdapter` class implementing `ProviderAdapter<ACPConfig, ACPExecuteInput, ACPExecuteOutput>`.
  3. Define `ACPConfig` type with fields: `endpoint: string`, `apiKeyRef: string` (credential store reference), `model: string`, `timeoutMs: number`, `maxRetries: number`.
  4. Implement `init(config: ACPConfig)`:
     - Resolve API key from credential store reference (spec 028 interface or stub).
     - Validate endpoint reachability with a lightweight probe request.
     - Set up internal ACP client state (connection pool, retry config).
     - Reject with `PROVIDER_INIT_FAILED` if init takes > 5s or endpoint unreachable.
  5. Implement `execute(input: ACPExecuteInput, correlationId: string)`:
     - Construct ACP request payload with correlation ID in metadata.
     - Send request to ACP endpoint with configured timeout.
     - Map ACP response to `ACPExecuteOutput` including token usage, model info, and result payload.
     - On timeout, throw `PROVIDER_TIMEOUT` normalized error.
     - On ACP error response, map to appropriate normalized error code.
  6. Implement `cancel(taskId: string)`:
     - Send cancellation request to ACP endpoint for the given task.
     - If task already completed, return success (idempotent).
     - If cancellation fails, throw normalized error.
  7. Implement `terminate()`:
     - Close connection pool.
     - Cancel any in-flight requests with `PROVIDER_TERMINATED` error.
     - Release all resources.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/acp-client.ts`
- Validation:
  - ACP client compiles and implements `ProviderAdapter` interface.
  - Init succeeds with valid config, fails with normalized error on bad config.
  - Execute propagates correlation ID round-trip.
  - Timeout produces `PROVIDER_TIMEOUT`, not unhandled rejection.
  - Cancel is idempotent.
  - Terminate cleans up all resources.
- Parallel: No.

### Subtask T007 - Wire ACP task execution to local bus with correlation

- Purpose: Ensure ACP task results are visible on the local bus with full traceability.
- Steps:
  1. In `acp-client.ts`, after successful execute, publish result to bus:
     - Topic: `provider.acp.execute.completed`
     - Payload: correlation ID, task ID, result summary, token usage, duration.
  2. On execute failure, publish failure event:
     - Topic: `provider.acp.execute.failed`
     - Payload: correlation ID, error code, retryable flag, error message.
  3. On cancel, publish cancellation event:
     - Topic: `provider.acp.execute.cancelled`
     - Payload: correlation ID, task ID.
  4. Ensure all bus events use the originating correlation ID from the execute input.
  5. Import bus from `apps/runtime/src/protocol/bus.ts` and use existing publish primitives.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/acp-client.ts`
- Validation:
  - Bus events are emitted for every execute outcome (success, failure, cancel).
  - Correlation IDs match between execute input and bus event payload.
  - No bus event is emitted without a correlation ID.
- Parallel: No.

### Subtask T008 - Integrate policy gate pre-execute hook

- Purpose: Block unauthorized ACP actions before contacting the ACP endpoint.
- Steps:
  1. Define a `PolicyGate` interface stub (or import from spec 023 if available):
     - `evaluate(action: string, context: PolicyContext): Promise<PolicyDecision>`
     - `PolicyDecision`: `{ allowed: boolean, reason?: string }`.
  2. In `ACPClientAdapter.execute()`, before constructing the ACP request:
     - Call `policyGate.evaluate('provider.acp.execute', { correlationId, input summary })`.
     - If denied, throw `PROVIDER_POLICY_DENIED` normalized error with the denial reason.
     - Publish `provider.acp.policy.denied` bus event with correlation ID and reason.
  3. Make policy gate injectable via constructor for testability.
  4. Default policy gate should be a pass-through (allow-all) stub until spec 023 delivers the real implementation.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/acp-client.ts`
- Validation:
  - Policy denial prevents ACP endpoint contact (no network call).
  - Policy denial produces normalized error with reason.
  - Bus event emitted on denial.
  - Default stub allows all actions (no blocking without explicit policy).
- Parallel: No.

### Subtask T009 - Implement ACP-specific health check

- Purpose: Monitor ACP endpoint availability and transition provider state accordingly.
- Steps:
  1. In `ACPClientAdapter`, implement `health()`:
     - Send lightweight health probe to ACP endpoint (e.g., models list or ping).
     - Track consecutive failures.
     - After 3 consecutive failures, transition to `degraded`.
     - After 5 consecutive failures, transition to `unavailable`.
     - On success after degraded/unavailable, reset failure count and transition to `healthy`.
  2. Publish health state transitions to bus:
     - Topic: `provider.acp.health.changed`
     - Payload: provider ID, previous state, new state, failure count, timestamp.
  3. Health check interval is configurable via `ACPConfig.healthCheckIntervalMs` (default 30000ms, minimum 5000ms).
  4. Health probe timeout should be separate from execute timeout (default 5s).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/acp-client.ts`
- Validation:
  - Health transitions are deterministic (3 failures -> degraded, 5 -> unavailable, 1 success -> healthy).
  - Bus events emitted only on state transitions, not on every check.
  - Configurable interval is respected.
  - Health probe timeout does not block execute calls.
- Parallel: Yes (after T006 skeleton is stable).

### Subtask T010 - Add integration tests for ACP lifecycle

- Purpose: Verify complete ACP lifecycle including init, execute, cancel, health, terminate against mock server.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/acp-client.test.ts`.
  2. Implement mock ACP server using Bun's HTTP server:
     - Configurable response behavior (success, error, timeout, slow response).
     - Request logging for correlation ID verification.
  3. Test scenarios:
     - **Init success**: valid config, endpoint reachable -> init completes.
     - **Init failure**: unreachable endpoint -> `PROVIDER_INIT_FAILED` within 5s.
     - **Execute success**: task dispatched, result returned with correlation ID.
     - **Execute timeout**: mock server delays beyond timeout -> `PROVIDER_TIMEOUT`.
     - **Execute policy denied**: mock policy gate denies -> `PROVIDER_POLICY_DENIED`, no server contact.
     - **Cancel success**: running task cancelled.
     - **Cancel idempotent**: cancel already-completed task -> success.
     - **Health transitions**: simulate 3 failures -> degraded, 5 -> unavailable, recovery -> healthy.
     - **Health bus events**: verify bus events emitted on state transitions only.
     - **Terminate cleanup**: verify no in-flight requests remain, connection pool closed.
     - **Correlation ID propagation**: verify ID appears in request to mock server and in bus events.
  4. Map tests to requirements:
     - FR-025-001 (lifecycle): init/execute/terminate tests.
     - FR-025-003 (ACP integration): all ACP-specific tests.
     - FR-025-009 (health checks): health transition tests.
     - FR-025-012 (policy gates): policy denied test.
  5. Ensure tests run via `bun test` or Vitest.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/acp-client.test.ts`
- Validation:
  - All test scenarios pass.
  - Coverage >=85% on acp-client.ts.
  - Each mapped FR has at least one test.
- Parallel: Yes (after T006 is stable).

## Test Strategy

- Mock ACP server provides configurable behavior for all test scenarios.
- Policy gate is injected as a mock for policy denial tests.
- Bus events are captured via test spy/subscription for correlation verification.
- Timeout tests use mock server delay to trigger timeout behavior deterministically.

## Risks & Mitigations

- Risk: ACP SDK changes break adapter contract.
- Mitigation: All tests use mock server; real ACP integration is validated in separate smoke test suite.
- Risk: Policy gate interface changes when spec 023 delivers.
- Mitigation: Policy gate is injected via interface; swap stub for real implementation when available.

## Review Guidance

- Confirm correlation IDs propagate from bus request through ACP call and back to bus event.
- Confirm policy denial prevents any network call to ACP endpoint.
- Confirm health state transitions are deterministic and bus-published only on transitions.
- Confirm timeout produces normalized error, not unhandled rejection.
- Confirm terminate cancels in-flight requests and releases resources.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:33:20Z – claude-haiku – shell_pid=70465 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:34:32Z – claude-haiku – shell_pid=70465 – lane=done – Implemented: ACP client adapter with all lifecycle methods
