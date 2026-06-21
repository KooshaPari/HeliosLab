# Functional Requirements — heliosApp Phase 3

**REPOID:** HELIOSAPP
**Phase:** 3 — Hexagonal Architecture + Traceability
**Date:** 2026-06-15

---

## FR-001 — Local Bus Decoupled Message Dispatch

**Title:** All inter-component communication MUST flow through a single `ILocalBusPort` contract.

**Description:** The runtime must route every command dispatch and event fan-out through the
`ILocalBusPort` primary port.  No component may call another component's concrete type directly.
This enforces decoupling and enables test-double injection.

**Acceptance Criteria:**
- `ILocalBusPort.dispatch()` returns a correlated `ResponseEnvelope` for every registered method.
- Unregistered method invocations return a structured error response (not a thrown exception).
- Event fan-out reaches all active subscribers before `publish()` resolves.

**Port:** `apps/runtime/src/ports/ILocalBusPort.ts`
**Spec:** `docs/specs/002-local-bus-v1-protocol-and-envelope/`

---

## FR-002 — Command Correlation Guarantee

**Title:** Every dispatched command MUST receive a response with a matching `correlation_id`.

**Description:** The bus must track in-flight commands by `id` / `correlation_id` so callers can
await their own response without observing responses to other concurrent commands.

**Acceptance Criteria:**
- Response `correlation_id` equals the originating command `id`.
- Concurrent distinct commands produce independent correlated responses.
- Timeout after configurable TTL with `BUS_TIMEOUT` error code.

**Port:** `apps/runtime/src/ports/ILocalBusPort.ts`
**Spec:** `docs/specs/002-local-bus-v1-protocol-and-envelope/`

---

## FR-003 — Workspace Isolation and Unique Naming

**Title:** Workspaces MUST be uniquely named and isolated by a typed `ws_` prefixed ID.

**Description:** The `IWorkspacePort` must reject duplicate workspace names and assign a ULID-based
`ws_` ID to every workspace.  Each workspace represents an independently addressable file-system
root for agent sessions.

**Acceptance Criteria:**
- `create()` throws `WORKSPACE_NAME_CONFLICT` when the name already exists in state `active`.
- All returned `Workspace.id` values match `/^ws_[0-9A-Z]{26}$/`.
- `delete()` rejects with `WORKSPACE_HAS_ACTIVE_SESSIONS` when active sessions remain.

**Port:** `apps/runtime/src/ports/IWorkspacePort.ts`
**Spec:** `docs/specs/003-workspace-and-project-metadata-persistence/`

---

## FR-004 — Append-Only Audit Trail

**Title:** The runtime MUST write every bus event to a durable, append-only audit store.

**Description:** `IAuditPort.append()` must be called for every `CommandEnvelope`,
`ResponseEnvelope`, and `EventEnvelope` that passes through the bus.  The store must support
structured query, time-bounded export, and retention-policy purge.

**Acceptance Criteria:**
- `append()` never throws; storage failures are logged and swallowed.
- `export()` returns a `RuntimeAuditBundle` with count = number of records in the time window.
- `purge(before)` deletes only records with `recorded_at < before`.

**Port:** `apps/runtime/src/ports/IAuditPort.ts`
**Spec:** `docs/specs/024-audit-logging-and-session-replay/`

---

## FR-005 — Pluggable AI Inference Provider

**Title:** AI inference MUST be accessed exclusively through the `IProviderPort` secondary port.

**Description:** The domain core must never reference Anthropic SDK types directly; it must
program to `IProviderPort`.  This allows alternative providers (local models, test doubles) to
be swapped without changes to core logic.

**Acceptance Criteria:**
- `infer()` returns `InferenceResponse` with populated `text`, `inputTokens`, and `outputTokens`.
- `healthCheck()` never throws; returns `{ ok: false, reason: string }` on network failure.
- Providers register with a unique `providerId` string; duplicate registration throws `PROVIDER_CONFLICT`.

**Port:** `apps/runtime/src/ports/IProviderPort.ts`
**Spec:** `docs/specs/025-provider-adapter-interface-and-lifecycle/`
