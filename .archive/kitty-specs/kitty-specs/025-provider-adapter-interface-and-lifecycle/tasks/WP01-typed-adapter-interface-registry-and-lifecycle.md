---
work_package_id: WP01
title: Typed Adapter Interface, Registry, and Lifecycle
lane: "done"
dependencies: []
base_branch: main
base_commit: 039b7751197f03069c47b149a88e5886d7562a69
created_at: '2026-03-01T13:29:56.110114+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 0 - Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "55629"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Typed Adapter Interface, Registry, and Lifecycle

## Objectives & Success Criteria

- Define a typed `ProviderAdapter` interface with init, health, execute, and terminate lifecycle methods.
- Implement a provider registry with configuration validation, credential binding, and concurrency limit enforcement.
- Deliver a normalized error taxonomy that maps all provider error types to common codes with retryable flags.
- Establish process-level isolation primitives that bind providers to lanes so failures isolate to the affected lane.

Success criteria:
- A mock provider can register, pass health checks, execute tasks, and terminate through the typed interface.
- Invalid configuration is rejected with a normalized error before any provider process is spawned.
- Process isolation wrapper prevents cross-lane resource leakage in tests.
- All error codes across provider types map to the normalized taxonomy with zero unmapped codes.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/025-provider-adapter-interface-and-lifecycle/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/025-provider-adapter-interface-and-lifecycle/spec.md`
- Existing protocol code:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/types.ts`

Constraints:
- TypeScript + Bun runtime.
- Process-level isolation via OS child processes, not in-process sandboxing.
- Adapter overhead < 10ms (p95); init < 5s (p95).
- Files target <=350 lines, hard limit <=500.
- Fail-fast behavior; no silent fallback.
- Coverage >=85% with FR-025-* traceability.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Define ProviderAdapter typed interface

- Purpose: Establish the contract all providers (ACP, MCP, A2A) must implement.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/adapter.ts`.
  2. Define `ProviderAdapter<TConfig, TExecuteInput, TExecuteOutput>` interface with generic type parameters for protocol-specific extensibility.
  3. Define lifecycle methods:
     - `init(config: TConfig): Promise<void>` -- initialize provider with validated config, must complete within 5s or throw timeout error.
     - `health(): Promise<ProviderHealthStatus>` -- return current health state (healthy, degraded, unavailable) with failure count and last-check timestamp.
     - `execute(input: TExecuteInput, correlationId: string): Promise<TExecuteOutput>` -- execute a task with mandatory correlation ID propagation.
     - `terminate(): Promise<void>` -- graceful shutdown, release all resources (child processes, FDs, memory).
  4. Define `ProviderHealthStatus` type with fields: `state: 'healthy' | 'degraded' | 'unavailable'`, `lastCheck: Date`, `failureCount: number`, `message?: string`.
  5. Define `ProviderRegistration<TConfig>` type with fields: `id: string`, `type: 'acp' | 'mcp' | 'a2a'`, `config: TConfig`, `workspaceId: string`, `concurrencyLimit: number`, `healthCheckIntervalMs: number`.
  6. Export all types and the interface.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/adapter.ts`
- Validation:
  - TypeScript compilation passes with strict mode.
  - Interface is usable by a mock implementation in tests.
  - Generic type parameters allow ACP, MCP, and A2A to specialize without type casts.
- Parallel: No.

### Subtask T002 - Implement provider registry with configuration validation

- Purpose: Manage provider registrations with validation, credential binding, and lifecycle tracking.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/registry.ts`.
  2. Implement `ProviderRegistry` class with:
     - `register(registration: ProviderRegistration): Promise<void>` -- validate config schema, bind credentials (delegate to spec 028 store interface or stub), call `adapter.init()`, add to active registry.
     - `unregister(providerId: string): Promise<void>` -- call `adapter.terminate()`, remove from registry, clean up credential bindings.
     - `get(providerId: string): ProviderAdapter | undefined` -- retrieve active adapter by ID.
     - `listByType(type: 'acp' | 'mcp' | 'a2a'): ProviderAdapter[]` -- list active adapters by protocol type.
     - `listByWorkspace(workspaceId: string): ProviderAdapter[]` -- list adapters bound to a workspace.
  3. Implement configuration validation:
     - Reject registrations with missing required fields.
     - Reject registrations with concurrency limits < 1 or > 100.
     - Reject registrations with health check intervals < 5000ms.
  4. Implement concurrency tracking per provider:
     - Track in-flight execute calls.
     - Reject execute calls that exceed the configured concurrency limit with a normalized error.
  5. Emit lifecycle events on the protocol bus: `provider.registered`, `provider.unregistered`, `provider.init.failed`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/registry.ts`
- Validation:
  - Registry accepts valid registrations and rejects invalid ones with specific error codes.
  - Concurrency limits are enforced under load.
  - Bus events are emitted for all lifecycle transitions.
- Parallel: No.

### Subtask T003 - Implement normalized error taxonomy

- Purpose: Map all provider error types (ACP, MCP, A2A, internal) to a common error code system.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/errors.ts`.
  2. Define `NormalizedProviderError` class extending `Error` with fields:
     - `code: string` -- e.g., `PROVIDER_INIT_FAILED`, `PROVIDER_TIMEOUT`, `PROVIDER_CRASHED`, `PROVIDER_POLICY_DENIED`, `PROVIDER_CONCURRENCY_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_EXECUTE_FAILED`, `PROVIDER_UNKNOWN`.
     - `providerSource: 'acp' | 'mcp' | 'a2a' | 'internal'`.
     - `retryable: boolean`.
     - `correlationId?: string`.
     - `originalError?: Error`.
  3. Define error code enum or const object with all recognized codes and their default retryable status.
  4. Implement `normalizeError(error: unknown, source: string, correlationId?: string): NormalizedProviderError` factory function.
  5. Implement `isRetryable(error: NormalizedProviderError): boolean` helper.
  6. Ensure every error code has a human-readable message template.
  7. Add JSDoc documentation for each error code explaining when it is used.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/errors.ts`
- Validation:
  - All known error scenarios map to a specific code (no `UNKNOWN` fallthrough for expected cases).
  - `normalizeError` handles null, undefined, string, Error, and custom error inputs.
  - Every error code is documented.
- Parallel: No.

### Subtask T004 - Implement process-level isolation wrapper

- Purpose: Ensure provider execution runs in child processes scoped to lanes, preventing cross-lane resource leaks on crash.
- Steps:
  1. Add process isolation utilities to `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/adapter.ts` or a new `isolation.ts` file.
  2. Implement `IsolatedProviderHost` class that:
     - Spawns a child process per provider-lane binding using Bun's `spawn` API.
     - Forwards init/health/execute/terminate calls to the child process via IPC (structured clone or JSON serialization).
     - Monitors child process health via heartbeat messages.
     - Detects child process crash (exit code != 0, signal kills) and reports via normalized error.
     - Cleans up child process resources (kill, wait, close IPC channels) on terminate or crash.
  3. Implement resource leak detection:
     - Track child process PIDs.
     - On terminate, verify no orphan child processes remain.
     - Log warning if cleanup takes > 1s.
  4. Bind isolation host to lane ID so that lane termination triggers provider terminate for all providers in that lane.
  5. Ensure provider crash in one lane does not affect providers in other lanes.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/adapter.ts` (or new `isolation.ts`)
- Validation:
  - Child process spawn and IPC communication work end-to-end.
  - Crash in child process produces normalized error without host process impact.
  - No orphan processes after terminate.
  - Lane-scoped isolation verified by running two providers in different lanes and crashing one.
- Parallel: Yes (after T001/T002 are stable).

### Subtask T005 - Add unit tests for adapter, registry, and error normalization

- Purpose: Lock interface contracts and error behavior before protocol-specific adapters are built.
- Steps:
  1. Create test directory `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/`.
  2. Add `adapter.test.ts`:
     - Test that a mock provider implementing `ProviderAdapter` compiles and can be used through the interface.
     - Test generic type parameter specialization for different config/input/output types.
     - Test that lifecycle methods are callable in expected order.
  3. Add `registry.test.ts`:
     - Test successful registration with valid config.
     - Test rejection of invalid config (missing fields, bad concurrency limits, bad health intervals).
     - Test concurrency limit enforcement (exceed limit, verify rejection with correct error code).
     - Test unregister calls terminate and removes from registry.
     - Test bus event emission for lifecycle transitions.
     - Test listByType and listByWorkspace filtering.
  4. Add `errors.test.ts`:
     - Test `normalizeError` with null, undefined, string, Error, and custom error inputs.
     - Test every error code maps to correct retryable status.
     - Test that no expected error scenario falls through to `PROVIDER_UNKNOWN`.
     - Test human-readable message generation for each code.
  5. Add `isolation.test.ts`:
     - Test child process spawn and IPC round-trip.
     - Test crash detection and normalized error reporting.
     - Test cleanup on terminate (no orphan processes).
  6. Ensure all tests run via `bun test` or Vitest.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/adapter.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/registry.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/errors.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/providers/__tests__/isolation.test.ts`
- Validation:
  - All tests pass.
  - Coverage >=85% on adapter.ts, registry.ts, errors.ts.
  - Each FR-025-001, FR-025-002, FR-025-007, FR-025-008, FR-025-011 has at least one mapped test.
- Parallel: Yes (after T001/T002/T003 are stable).

## Test Strategy

- Run unit tests via Bun/Vitest.
- Mock providers implement `ProviderAdapter` interface with configurable behavior (success, failure, timeout, crash).
- Process isolation tests use real child processes with mock provider logic.
- Coverage gate: >=85% on all files in `apps/runtime/src/providers/`.

## Risks & Mitigations

- Risk: Generic type parameters too complex for downstream adapters.
- Mitigation: Provide concrete type aliases for ACP, MCP, A2A configurations in adapter.ts.
- Risk: Child process IPC serialization overhead exceeds 10ms budget.
- Mitigation: Benchmark IPC round-trip in T005 isolation tests; switch to shared memory if needed.

## Review Guidance

- Confirm `ProviderAdapter` interface supports all three protocol types without type casts.
- Confirm registry rejects all invalid configurations with specific error codes.
- Confirm normalized error taxonomy covers all expected failure modes.
- Confirm process isolation prevents cross-lane resource leakage.
- Confirm no silent fallback or ignore paths in any validation.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
- 2026-03-01T13:29:56Z – claude-haiku – shell_pid=55629 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:33:13Z – claude-haiku – shell_pid=55629 – lane=done – Implemented: All 5 subtasks complete
