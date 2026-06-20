# Phase 4 spec — port adapters + trace-store + network port (maximal scope)

**Status:** DRAFT — awaiting user approval before any code lands
**Date:** 2026-06-19
**Builds on:** PR #493 (merged Phase 3 ports + FR-001..FR-005 traceability)
**Scope:** maximal — concrete adapters for all 5 Phase 3 ports + 2 new ports (trace-store, network)

## Motivation

Phase 3 delivered 5 pure port interfaces but left the existing implementations (`apps/runtime/src/protocol/bus/emitter.ts`, `audit/ledger.ts`, `workspace/store.ts`, `sessions/state_machine.ts`, `packages/runtime-core/src/api-client.ts`) unwrapped. Runtime code calls the concrete modules directly — no inversion. Phase 4 closes the gap and adds two new ports that the runtime already needs:

- `ITraceStorePort` — pino logger bridge for structured observability
- `INetworkPort` — `ky` HTTP client bridge for outbound requests

This is **maximal scope**: all 5 adapter wrappings + 2 new ports + FR-006/FR-007 + tests + traceability.

## Port inventory

| Port | Default adapter source | FR |
|---|---|---|
| `ILocalBusPort` | `apps/runtime/src/protocol/bus/emitter.ts` (`InMemoryLocalBus`) | FR-001 |
| `IWorkspacePort` | `apps/runtime/src/workspace/store.ts` (`WorkspaceStore`) | FR-002 |
| `IAuditPort` | `apps/runtime/src/audit/ledger.ts` (`AuditLedger`) | FR-003 |
| `ISessionPort` | `apps/runtime/src/sessions/state_machine.ts` (`SessionStateMachine`) | FR-004 |
| `IProviderPort` | `packages/runtime-core/src/api-client.ts` (`ApiClient`) | FR-005 |
| **`ITraceStorePort`** (NEW) | existing pino logger in `apps/runtime/src/observability/logger.ts` | **FR-006** |
| **`INetworkPort`** (NEW) | existing `ky` instance in `apps/runtime/src/net/http.ts` | **FR-007** |

## Architecture

### Hexagonal adapter pattern (consistent with Phase 3)

Every adapter is a thin class that:
- Lives under `apps/runtime/src/adapters/<port-name>/<adapter>.ts`
- Implements the corresponding `I<Name>Port` interface 1:1
- Delegates all real work to the existing module (no re-implementation)
- Adds zero new dependencies
- Adds zero new I/O paths in `ports/` (adapter owns all I/O, ports stay pure)

### New port signatures (sketch — refine during code)

```ts
// apps/runtime/src/ports/ITraceStorePort.ts
export interface ITraceStorePort {
  readonly name: 'trace-store';
  child(bindings: Record<string, unknown>): ITraceStorePort;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

// apps/runtime/src/ports/INetworkPort.ts
export interface INetworkPort {
  readonly name: 'network';
  get<T>(url: string, opts?: { searchParams?: Record<string, string>; headers?: Record<string, string>; timeoutMs?: number }): Promise<T>;
  post<T>(url: string, body: unknown, opts?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<T>;
  withRetry(policy: { retries: number; backoffMs: number }): INetworkPort;
}
```

Both ports must respect the Phase 3 constraints: **no I/O in `ports/`**, no time/random without injection, no panics, no global state.

## Adapter deliverables

For each of the 7 ports:

1. **Adapter class** at `apps/runtime/src/adapters/<port>/<adapter>.ts` — implements the port interface, delegates to the existing module
2. **Factory** at `apps/runtime/src/adapters/<port>/index.ts` — `create<Name>Port(deps)` returns the adapter
3. **Black-box test** at `apps/runtime/tests/ports/<port>.test.ts` — uses only the public port interface, exercises the real adapter (no mocks for adapter logic; only deps injected via constructor)
4. **FR-006/FR-007 entries** in `docs/specs/FR.md`
5. **TRACEABILITY.md** updates mapping FR → port → adapter → test file

Total: ~7 adapters + 7 tests + FR doc updates + traceability updates.

## Diff budget

| Component | Files | Lines (est.) |
|---|---|---|
| 2 new ports (interfaces) | 2 | ~60 |
| 7 adapter implementations | 7 | ~350 |
| 7 adapter factories | 7 | ~70 |
| 7 black-box tests | 7 | ~600 |
| FR-006/FR-007 doc entries | 1 | ~30 |
| TRACEABILITY.md updates | 1 | ~20 |
| `ports/index.ts` re-exports | 1 | ~10 |
| **Total** | **~32** | **~1140** |

Within budget: ≤ 2000 lines, ≤ 25 files... wait, **32 files busts the 25-file budget**. Need to either:

- **(a)** split into 2 PRs (FR-006/007 ports + adapters first, then trace/network ports)
- **(b)** consolidate adapter+factory+test into single files per port (saves ~14 files → 18 total, in budget)
- **(c)** request budget increase

**Recommendation:** option **(b)** — co-locate adapter class + factory + test in `apps/runtime/src/adapters/<port>/<port>.ts` for the adapter/factory, and `apps/runtime/tests/ports/<port>.test.ts` for the test. Cuts to ~14-18 files.

## Risks

- **Adapter drift** — adapters delegate to existing modules; if those modules change, adapters break. Mitigation: thin wrappers + typed return contracts.
- **`ky` retry semantics** — `INetworkPort.withRetry` needs careful design to not double-retry on top of `ky`'s built-in retry.
- **Pino binding propagation** — `child()` must preserve trace context (correlation IDs from `IAuditPort`). Test must verify correlation flows.
- **Backwards compat** — existing callers reference `InMemoryLocalBus`, `AuditLedger`, etc. directly. Adapter introduction is additive, not breaking — but to remove direct refs requires follow-up.

## Out of scope

- Replacing existing modules with the adapters (touch every caller — defer to Phase 5)
- Distributed trace propagation across processes
- New audit storage backends (only the existing JSONL+SQLite)
- Network mocking utilities for tests (use existing `ky` mocks)

## Acceptance criteria

1. All 7 port interfaces compile and are exported from `apps/runtime/src/ports/index.ts`
2. All 7 adapter factories pass their black-box tests
3. FR-006 and FR-007 documented in `docs/specs/FR.md` with same shape as FR-001..FR-005
4. TRACEABILITY.md maps FR → port → adapter → test file
5. Anti-wipe gate: 0 deletions (all additive)
6. Diff budget: ≤ 25 files, ≤ 2000 lines (achieved via option (b) co-location)
7. `bun run typecheck` and `bun test` pass on the branch
8. PR #494+ merged without violating the workflow gates (which means: don't touch `.github/workflows/trufflehog.yml` — the action resolution bug is orthogonal)

## Resumption check-in

This spec is the deliverable the pending todo requested. No code lands until you confirm. Once approved I'll:
1. Open branch `feat/phase4-port-adapters`
2. Land adapters in PR #494 (5 existing ports)
3. Land trace + network ports in PR #495
4. Update FR.md + TRACEABILITY.md in each
5. Wait for each PR's green before the next