---
work_package_id: WP07
title: Protocol Boundary Delegation and Traceability Gates
lane: "done"
dependencies:
- WP06
base_branch: 001-colab-agent-terminal-control-plane-WP06
base_commit: 9f5060adc6e1931099c808f5354bc46c179e4488
created_at: '2026-02-27T07:52:58.629967+00:00'
subtasks:
- T031
- T032
- T033
- T034
- T035
- T036
phase: Phase 4 - Boundary completeness
assignee: ''
agent: ''
shell_pid: "25766"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-26T13:19:35Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP07 - Protocol Boundary Delegation and Traceability Gates

## Objectives & Success Criteria

- Complete FR-010 by implementing explicit local/tool/A2A boundary contracts and dispatch behavior.
- Enforce constitution-aligned quality gates: coverage threshold and requirement traceability.

Success criteria:
- Boundary dispatch is deterministic and test-covered.
- Coverage gate fails below 85% baseline.
- Requirement-traceability gate fails when FR/NFR mappings are missing.

## Context & Constraints

- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/spec.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/plan.md`
- Tasks: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/tasks.md`
- Constitution: `docs/reference/constitution.md`

Implementation command:
- `spec-kitty implement WP07 --base WP06`

## Subtasks & Detailed Guidance

### Subtask T031 - Define FR-010 boundary contract mapping
- Purpose: make local/tool/A2A boundaries explicit in shared protocol assets.
- Steps:
  1. Update protocol methods/topics and spec references for boundary naming.
  2. Ensure each boundary has canonical command/event coverage.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/specs/protocol/v1/methods.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/specs/protocol/v1/topics.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/spec.md`

### Subtask T032 - Implement protocol boundary adapter dispatch
- Purpose: route requests through explicit boundary adapter paths.
- Steps:
  1. Implement boundary adapter module and typed dispatch discriminants.
  2. Wire dispatch to runtime execution integration points.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/protocol/boundary_adapter.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/exec.ts`

### Subtask T033 - Add delegation routing and normalization tests
- Purpose: verify deterministic routing and stable error handling by boundary.
- Steps:
  1. Add unit tests for dispatch selection.
  2. Add integration tests for local/tool/A2A boundary behavior and errors.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/protocol/`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/protocol/`

### Subtask T034 - Enforce coverage threshold gate
- Purpose: operationalize constitution minimum coverage target.
- Steps:
  1. Configure coverage thresholds (`>=85%` baseline).
  2. Fail CI/local checks when threshold is not met.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/package.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/vitest.config.ts`

### Subtask T035 - Enforce requirement traceability gate
- Purpose: guarantee requirement-to-test linkage exists.
- Steps:
  1. Add trace matrix validator for FR/NFR mapping.
  2. Integrate validator into quality gate command chain.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/`

### Subtask T036 - Add fail-closed validation fixtures
- Purpose: prove gates fail when requirements are violated.
- Steps:
  1. Add fixtures/scenarios that intentionally violate coverage/traceability.
  2. Assert gate command exits non-zero as expected.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/`

## Test Strategy

- Execute unit/integration boundary tests.
- Execute coverage and traceability gate checks in fail/pass scenarios.

## Risks & Mitigations

- Risk: boundary ambiguity under mixed requests.
- Mitigation: strict discriminated union dispatch and explicit unsupported-mode errors.

## Review Guidance

- Confirm FR-010 mappings are explicit in spec/protocol/runtime.
- Confirm quality gates fail closed.

## Activity Log

- 2026-02-26T13:19:35Z – system – lane=planned – Prompt created.
- 2026-02-27T08:00:41Z – unknown – shell_pid=25766 – lane=for_review – Implemented with boundary adapter + coverage/traceability gates; ready for review.
- 2026-03-01T13:23:01Z – unknown – shell_pid=25766 – lane=done – Merged to main
