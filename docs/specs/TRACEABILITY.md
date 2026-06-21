# Traceability Matrix — heliosApp Phase 3

**REPOID:** HELIOSAPP
**Phase:** 3 — Hexagonal Architecture + Traceability
**Date:** 2026-06-15

---

## Overview

This matrix maps each Phase 3 Functional Requirement to its port contract, implementation
module(s), and covering test(s).

| FR ID  | Title (short)                      | Port Interface                              | Impl Module(s)                                      | Covering Tests                                                                 |
|--------|------------------------------------|---------------------------------------------|-----------------------------------------------------|--------------------------------------------------------------------------------|
| FR-001 | Local Bus Decoupled Dispatch       | `src/ports/ILocalBusPort.ts`                | `src/protocol/bus.ts`                               | `tests/unit/protocol/bus.test.ts`<br>`tests/unit/protocol/protocol_bus.test.ts` |
| FR-002 | Command Correlation Guarantee      | `src/ports/ILocalBusPort.ts`                | `src/protocol/bus.ts`<br>`src/protocol/envelope.ts` | `tests/unit/protocol/bus.test.ts`<br>`tests/unit/protocol/envelope.test.ts`    |
| FR-003 | Workspace Isolation + Unique Names | `src/ports/IWorkspacePort.ts`               | `src/workspace/workspace.ts`<br>`src/workspace/store.ts` | `tests/unit/workspace/workspace.test.ts`<br>`tests/unit/workspace/store.test.ts` |
| FR-004 | Append-Only Audit Trail            | `src/ports/IAuditPort.ts`                   | `src/audit/ledger.ts`<br>`src/audit/sqlite-store.ts` | `tests/unit/audit/ledger.test.ts`<br>`tests/unit/audit/sqlite-store.test.ts`  |
| FR-005 | Pluggable AI Inference Provider    | `src/ports/IProviderPort.ts`                | `packages/runtime-core/src/api-client.ts`           | `packages/runtime-core` (via integration tests)                                |

All paths above are relative to `apps/runtime/` unless prefixed with `packages/`.

---

## FR-001: Local Bus Decoupled Dispatch

- **Port:** `apps/runtime/src/ports/ILocalBusPort.ts`
- **Tests:**
  - `apps/runtime/tests/unit/protocol/bus.test.ts` — command dispatch, event fan-out, handler registration
  - `apps/runtime/tests/unit/protocol/protocol_bus.test.ts` — protocol conformance

---

## FR-002: Command Correlation Guarantee

- **Port:** `apps/runtime/src/ports/ILocalBusPort.ts`
- **Tests:**
  - `apps/runtime/tests/unit/protocol/bus.test.ts` — correlation_id roundtrip
  - `apps/runtime/tests/unit/protocol/envelope.test.ts` — envelope construction, id generation

---

## FR-003: Workspace Isolation and Unique Naming

- **Port:** `apps/runtime/src/ports/IWorkspacePort.ts`
- **Tests:**
  - `apps/runtime/tests/unit/workspace/workspace.test.ts` — CRUD lifecycle, duplicate name rejection
  - `apps/runtime/tests/unit/workspace/store.test.ts` — persistence adapter
  - `apps/runtime/tests/unit/workspace/events.test.ts` — workspace lifecycle events

---

## FR-004: Append-Only Audit Trail

- **Port:** `apps/runtime/src/ports/IAuditPort.ts`
- **Tests:**
  - `apps/runtime/tests/unit/audit/ledger.test.ts` — append + query
  - `apps/runtime/tests/unit/audit/sqlite-store.test.ts` — durable storage
  - `apps/runtime/tests/unit/audit/retention.test.ts` — purge policy
  - `apps/runtime/tests/unit/audit/export.test.ts` — time-bounded export

---

## FR-005: Pluggable AI Inference Provider

- **Port:** `apps/runtime/src/ports/IProviderPort.ts`
- **Tests:**
  - `packages/runtime-core/` — api-client unit tests (sendMessages, extractTextContent, toAnthropicHistory)
  - Integration tests under `apps/runtime/tests/integration/` (provider health-check path)
