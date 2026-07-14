---
work_package_id: WP08
title: Durability Follow-On Placeholder and Retention Compliance
lane: "done"
dependencies:
- WP05
base_branch: 001-colab-agent-terminal-control-plane-WP07
base_commit: 9f5060adc6e1931099c808f5354bc46c179e4488
created_at: '2026-02-27T07:52:59.521476+00:00'
subtasks:
- T037
- T038
- T039
- T040
- T041
- T042
phase: Phase 4 - Durability and compliance
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

# Work Package Prompt: WP08 - Durability Follow-On Placeholder and Retention Compliance

## Objectives & Success Criteria

- Define explicit slice-2 durability handoff boundaries without silently enabling persistence in slice-1.
- Implement retention policy and export-completeness compliance behavior for lifecycle audit data.

Success criteria:
- Slice-2 persistence/checkpoint contracts are explicit and traceable.
- Retention policy is configurable and test-covered.
- Export completeness and redaction behavior is validated.

## Context & Constraints

- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/spec.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/plan.md`
- Data model: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/data-model.md`
- Constitution: `docs/reference/constitution.md`

Implementation command:
- `spec-kitty implement WP08 --base WP07`

## Subtasks & Detailed Guidance

### Subtask T037 - Define slice-2 durability placeholder contract
- Purpose: codify deferred persistence boundaries in planning artifacts.
- Steps:
  1. Update plan/data model with explicit durable store/checkpoint entities and scope notes.
  2. Ensure slice-1 vs slice-2 lines are unambiguous.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/plan.md`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/data-model.md`

### Subtask T038 - Add checkpoint persistence interface stubs
- Purpose: prepare interfaces for later durable implementation without enabling it now.
- Steps:
  1. Add persistence/checkpoint interfaces and explicit TODO markers.
  2. Keep runtime behavior unchanged for slice-1.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/sessions/`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/`

### Subtask T039 - Implement retention policy model and hooks
- Purpose: satisfy NFR-005 retention requirements.
- Steps:
  1. Add retention configuration model with default >=30 days.
  2. Add enforcement hooks for policy-driven expiry while preserving auditability.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/config/`

### Subtask T040 - Add retention compliance tests
- Purpose: verify policy behavior across expiry and exception scenarios.
- Steps:
  1. Add tests for TTL expiry and policy exceptions.
  2. Validate deletion proofs are emitted to audit trail.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/integration/recovery/`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/audit/`

### Subtask T041 - Add export completeness compliance tests
- Purpose: guarantee required correlated fields are exported and sensitive fields redacted.
- Steps:
  1. Define required export-field contract.
  2. Add tests for completeness and redaction correctness.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/audit/`

### Subtask T042 - Update quickstart and ops verification guidance
- Purpose: document compliance and deferred durability workflow for implementers/reviewers.
- Steps:
  1. Update quickstart with retention and compliance verification commands.
  2. Document slice-2 durability placeholders and non-goals clearly.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/quickstart.md`

## Test Strategy

- Run retention policy unit/integration suites.
- Run export completeness/redaction checks.
- Verify no slice-1 behavior regression from placeholder interfaces.

## Risks & Mitigations

- Risk: placeholder interfaces accidentally activate partial persistence.
- Mitigation: explicit feature guards and non-operational stub behavior.

## Review Guidance

- Verify slice-2 boundaries are explicit and not silently in-scope for slice-1.
- Verify retention/export compliance is measurable and test-enforced.

## Activity Log

- 2026-02-26T13:19:35Z – system – lane=planned – Prompt created.
- 2026-02-27T08:00:44Z – unknown – shell_pid=25766 – lane=for_review – Implemented durability placeholders + retention/export compliance; ready for review.
- 2026-03-01T13:23:02Z – unknown – shell_pid=25766 – lane=done – Merged to main
