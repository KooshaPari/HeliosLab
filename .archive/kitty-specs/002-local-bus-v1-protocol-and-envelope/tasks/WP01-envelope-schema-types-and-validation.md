---
work_package_id: WP01
title: Envelope Schema, Types, and Validation
lane: "done"
dependencies: []
base_branch: main
base_commit: d89dc4f54d56d98a0ded78813aeffc0ed68d1dd0
created_at: '2026-02-27T11:19:15.585730+00:00'
subtasks: [T001, T002, T003, T004, T005, T006]
phase: Phase 1 - Foundation
assignee: ''
agent: "wp01-bus-agent"
shell_pid: "22522"
reviewed_by: "Koosha Paridehpour"
review_status: "approved"
---

# Work Package Prompt: WP01 - Envelope Schema, Types, and Validation

## Objectives & Success Criteria

- Define the canonical envelope schema that every bus message must conform to.
- Establish discriminated union types for command, response, and event envelopes.
- Implement strict validation that rejects malformed envelopes before routing.
- Define the error taxonomy used throughout the bus subsystem.
- Publish JSON schema assets for external tooling and cross-repo validation.

Success criteria:
- All envelope types compile with strict TypeScript checks.
- Validation rejects 100% of malformed payloads with structured errors.
- JSON schema and runtime types are provably aligned.
- Error taxonomy covers all bus failure modes: `VALIDATION_ERROR`, `METHOD_NOT_FOUND`, `HANDLER_ERROR`, `TIMEOUT`, `BACKPRESSURE`.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/002-local-bus-v1-protocol-and-envelope/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/002-local-bus-v1-protocol-and-envelope/spec.md`
- Existing protocol code:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/types.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/specs/protocol/v1/`

Constraints:
- Fail-fast validation: no silent fallback or partial acceptance.
- Payload size limit configurable, default 1 MB.
- Keep files under 350 lines (hard limit 500).
- IDs use spec 005 format (`{prefix}_{ulid}`) — import from `packages/ids/` when available, stub if not.

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Define envelope TypeScript interfaces and discriminated unions

- Purpose: establish the core type contract that all bus consumers depend on.
- Steps:
  1. Open `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/types.ts`.
  2. Define a base `EnvelopeBase` interface with fields: `id: string`, `correlation_id: string`, `timestamp: number`, `sequence?: number`.
  3. Define `CommandEnvelope` extending base with `type: 'command'`, `method: string`, `payload: unknown`.
  4. Define `ResponseEnvelope` extending base with `type: 'response'`, `method: string`, `payload: unknown`, `error?: BusError`.
  5. Define `EventEnvelope` extending base with `type: 'event'`, `topic: string`, `payload: unknown`, `sequence: number`.
  6. Export discriminated union `Envelope = CommandEnvelope | ResponseEnvelope | EventEnvelope`.
  7. Export type guards: `isCommand(e)`, `isResponse(e)`, `isEvent(e)`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/types.ts`
- Validation checklist:
  - [ ] All three envelope shapes compile under `strict: true`.
  - [ ] Type guards narrow correctly in conditional blocks.
  - [ ] `Envelope` union covers exactly three members.
- Edge cases:
  - Ensure `payload: unknown` (not `any`) to force consumer type narrowing.
  - `sequence` is optional on command/response, required on events.
- Parallel: No.

### Subtask T002 - Define error taxonomy types and constructors

- Purpose: provide structured error representation for all bus failure modes.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/errors.ts`.
  2. Define `BusErrorCode` string literal union: `'VALIDATION_ERROR' | 'METHOD_NOT_FOUND' | 'HANDLER_ERROR' | 'TIMEOUT' | 'BACKPRESSURE'`.
  3. Define `BusError` interface: `{ code: BusErrorCode; message: string; details?: unknown }`.
  4. Implement factory functions: `validationError(message, details?)`, `methodNotFound(method)`, `handlerError(method, cause)`, `timeoutError(method, timeoutMs)`, `backpressureError(topic)`.
  5. Each factory returns a frozen `BusError` object.
  6. Export all types and factories.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/errors.ts`
- Validation checklist:
  - [ ] All five error codes have corresponding factory functions.
  - [ ] Factory return types are `Readonly<BusError>`.
  - [ ] Factories never throw — they produce error values.
- Edge cases:
  - `details` on `HANDLER_ERROR` must sanitize stack traces (no file system paths in production).
- Parallel: No.

### Subtask T003 - Implement envelope creation helpers

- Purpose: provide a single entry point for creating well-formed envelopes with auto-generated IDs and timestamps.
- Steps:
  1. Create or update `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/envelope.ts`.
  2. Implement `createCommand(method, payload, correlationId?)`: generates `id` (using spec 005 or stub), sets `correlation_id` (generate if not provided), sets `timestamp` from monotonic clock, returns `CommandEnvelope`.
  3. Implement `createResponse(command, payload, error?)`: copies `correlation_id` and `method` from originating command, generates new `id`, returns `ResponseEnvelope`.
  4. Implement `createEvent(topic, payload, correlationId?, sequence?)`: generates `id`, sets `correlation_id`, sets `timestamp`, returns `EventEnvelope`. Sequence is set by topic registry at publish time, not by caller.
  5. All helpers validate their inputs before constructing the envelope.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/envelope.ts`
- Validation checklist:
  - [ ] `createCommand` without correlationId auto-generates one.
  - [ ] `createResponse` always carries the originating command's correlation_id.
  - [ ] `createEvent` leaves sequence as 0 (placeholder for topic registry assignment).
  - [ ] All timestamps use monotonic clock source.
- Edge cases:
  - If spec 005 ID library is not yet available, implement a temporary ULID stub with TODO marker.
- Parallel: No.

### Subtask T004 - Implement strict envelope validation

- Purpose: gate all bus routing behind schema validation to prevent malformed messages from propagating.
- Steps:
  1. In `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/envelope.ts`, implement `validateEnvelope(envelope: unknown): { valid: true; envelope: Envelope } | { valid: false; error: BusError }`.
  2. Check required fields: `id` (non-empty string), `correlation_id` (non-empty string), `type` (one of 'command'|'response'|'event'), `timestamp` (positive number).
  3. For commands: require `method` (non-empty string) and `payload`.
  4. For events: require `topic` (non-empty string) and `payload`.
  5. Check payload size: `JSON.stringify(payload).length <= MAX_PAYLOAD_SIZE` (configurable, default 1 MB).
  6. Return `validationError` from error taxonomy on any failure.
  7. Export `MAX_PAYLOAD_SIZE` as configurable constant.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/envelope.ts`
- Validation checklist:
  - [ ] Missing `id` returns VALIDATION_ERROR.
  - [ ] Missing `correlation_id` returns VALIDATION_ERROR.
  - [ ] Unknown `type` returns VALIDATION_ERROR.
  - [ ] Oversized payload returns VALIDATION_ERROR with size info.
  - [ ] Valid envelopes return the narrowed typed envelope.
- Edge cases:
  - `payload` of `undefined` vs `null` — both are acceptable (present but empty).
  - Circular references in payload must not crash validation (catch JSON.stringify errors).
- Parallel: No.

### Subtask T005 - Create JSON schema assets

- Purpose: provide machine-readable schema for external tooling, documentation, and cross-repo validation.
- Steps:
  1. Create or update `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/specs/protocol/v1/envelope.schema.json`.
  2. Define JSON Schema draft-07 with `oneOf` for command, response, and event shapes.
  3. Include all required fields matching T001 type definitions exactly.
  4. Add `maxLength` constraint on payload matching `MAX_PAYLOAD_SIZE`.
  5. Include `enum` constraint for `type` field.
  6. Add schema `$id` and `title` metadata.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/specs/protocol/v1/envelope.schema.json`
- Validation checklist:
  - [ ] Schema validates all three envelope shapes.
  - [ ] Schema rejects payloads missing required fields.
  - [ ] Schema `$id` follows convention.
- Edge cases:
  - Ensure `additionalProperties: false` is NOT set at top level to allow forward compat.
- Parallel: Yes (after T001 types are stable).

### Subtask T006 - Add Vitest unit tests for envelope and error taxonomy

- Purpose: lock envelope creation, validation, and error behavior before higher-level routing work.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/protocol/envelope.test.ts`.
  2. Test `createCommand`: generates unique IDs, auto-generates correlation_id, sets timestamp.
  3. Test `createResponse`: carries originating correlation_id, references method.
  4. Test `createEvent`: sets type='event', topic, placeholder sequence.
  5. Test `validateEnvelope`: positive cases for all three shapes; negative cases for missing id, missing correlation_id, unknown type, oversized payload, circular payload.
  6. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/protocol/errors.test.ts`.
  7. Test all five error factory functions: correct code, frozen object, message content.
  8. Add FR traceability comments: `// FR-001`, `// FR-006`, `// FR-007`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/protocol/envelope.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/protocol/errors.test.ts`
- Validation checklist:
  - [ ] >= 20 test cases covering positive and negative paths.
  - [ ] Every FR referenced in at least one test comment.
  - [ ] Tests run in < 5 seconds.
- Edge cases:
  - Test with empty string IDs, negative timestamps, NaN sequences.
- Parallel: Yes (after T001/T002 are stable).

## Test Strategy

- Run unit tests via `bun test` / Vitest.
- Cover all envelope shapes and error codes.
- Negative tests outnumber positive tests (defensive validation).
- Keep test fixtures minimal and deterministic.

## Risks & Mitigations

- Risk: JSON schema and TypeScript types diverge.
- Mitigation: T018 (WP03) adds automated parity check; during WP01, manual review is required.
- Risk: payload size check is expensive for large payloads.
- Mitigation: short-circuit on `typeof payload !== 'object'` fast path.

## Review Guidance

- Confirm discriminated union exhaustiveness in type guards.
- Confirm validation rejects every known bad shape.
- Confirm error factories produce immutable objects.
- Confirm no `any` types in public API surface.

## Activity Log

- 2026-02-27 – system – lane=planned – Prompt generated.
- 2026-02-27T11:19:15Z – wp01-bus-agent – shell_pid=22522 – lane=doing – Assigned agent via workflow command
- 2026-02-27T11:24:07Z – wp01-bus-agent – shell_pid=22522 – lane=for_review – Ready for review: Envelope schema types, error taxonomy, creation helpers, strict validation, JSON schema, and 54 unit tests
- 2026-03-01T13:20:10Z – wp01-bus-agent – shell_pid=22522 – lane=done – Review passed: auto-approved
- 2026-03-01T13:23:19Z – wp01-bus-agent – shell_pid=22522 – lane=done – Merged to main
