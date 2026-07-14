---
work_package_id: WP01
title: Protocol Contracts and Runtime Foundation
lane: "done"
dependencies: []
base_branch: main
base_commit: f1d0bc01693c809a121c904e94a68cf81422b4a2
created_at: '2026-02-26T16:35:07.704643+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 1 - Foundation
assignee: ''
agent: "codex"
shell_pid: "65388"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-26T13:19:35Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Protocol Contracts and Runtime Foundation

## Objectives & Success Criteria

- Establish strict protocol contracts and runtime validation primitives for lane/session/terminal orchestration.
- Guarantee deterministic event sequencing and required correlation IDs for lifecycle-critical operations.
- Deliver baseline audit sink scaffolding and protocol tests that block schema drift.

Success criteria:
- Runtime rejects malformed envelopes with stable error semantics.
- Event ordering logic is deterministic and test-covered.
- Topic/method assets and runtime type layer are aligned and reviewed.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/plan.md`
- Contracts: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/contracts/`
- Existing protocol code:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/types.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/specs/protocol/v1/`

Constraints:
- Fail-fast behavior in protocol core (no silent fallback).
- Low-overhead data-plane friendly validation.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Align protocol method/topic assets
- Purpose: ensure schema assets represent current slice-1 lifecycle events and methods.
- Steps:
  1. Review `contracts/orchestration-envelope.schema.json` and map required topics/methods.
  2. Update `specs/protocol/v1/topics.json` and `specs/protocol/v1/methods.json` for lane/session/terminal/harness flows.
  3. Preserve naming stability for future compatibility.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/specs/protocol/v1/topics.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/specs/protocol/v1/methods.json`
- Parallel: No.

### Subtask T002 - Implement envelope validator and typed helpers
- Purpose: create strict runtime type guards and validation entrypoints.
- Steps:
  1. Add or refine envelope interfaces and discriminated unions in `types.ts`.
  2. Implement validation function(s) in `bus.ts` or a focused protocol validator module.
  3. Enforce required fields (`correlation_id`, `topic`, context IDs as applicable).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/types.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`
- Parallel: No.

### Subtask T003 - Add deterministic sequencing and correlation guardrails
- Purpose: guarantee lifecycle event order and traceability.
- Steps:
  1. Add sequence stamping strategy inside bus publish pipeline.
  2. Reject or quarantine envelopes that violate required ordering assumptions.
  3. Emit explicit errors for missing/invalid correlation IDs.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/bus.ts`
- Parallel: No.

### Subtask T004 - Add audit sink scaffolding
- Purpose: establish append-only audit integration point used by downstream WPs.
- Steps:
  1. Create minimal audit module and sink interface.
  2. Wire bus publish success/failure hooks to audit sink.
  3. Keep implementation lightweight; full audit fidelity arrives later.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/index.ts`
- Parallel: Yes (after T002 contract surface stabilizes).

### Subtask T005 - Add protocol unit tests
- Purpose: lock envelope and ordering behavior before higher-level lifecycle work.
- Steps:
  1. Add positive and negative tests for validation.
  2. Add event ordering tests using synthetic lane/session/terminal topics.
  3. Add regression tests for correlation-id requirement.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/protocol/`
- Parallel: Yes.

## Test Strategy

- Run protocol-focused unit tests via Bun/Vitest.
- Validate malformed envelope rejection and deterministic ordering assertions.
- Keep test fixtures minimal and deterministic.

## Risks & Mitigations

- Risk: schema/runtime divergence.
- Mitigation: co-update `specs/protocol/v1/` and runtime literals in same changeset.
- Risk: ordering logic adds overhead.
- Mitigation: simple monotonic sequencing with bounded metadata.

## Review Guidance

- Confirm every lifecycle topic is represented consistently in schema and runtime code.
- Confirm missing correlation IDs fail clearly.
- Confirm no fallback/ignore path in protocol validator.

## Activity Log

- 2026-02-26T13:19:35Z – system – lane=planned – Prompt created.
- 2026-02-26T16:52:45Z – unknown – shell_pid=94640 – lane=for_review – Ready for review: protocol contracts/runtime foundation implemented in worktree commit efb2ad9
- 2026-02-27T07:48:10Z – unknown – shell_pid=94640 – lane=for_review – Restacked and fully smoke-validated; ready for review.
- 2026-02-27T08:56:21Z – codex – shell_pid=65388 – lane=doing – Started review via workflow command
- 2026-02-27T08:56:54Z – codex – shell_pid=65388 – lane=done – Review passed: protocol contracts/validator sequencing/audit behavior validated; unit protocol suite 14/14 passing; dependency and coupling checks consistent
- 2026-03-01T13:22:52Z – codex – shell_pid=65388 – lane=done – Merged to main
