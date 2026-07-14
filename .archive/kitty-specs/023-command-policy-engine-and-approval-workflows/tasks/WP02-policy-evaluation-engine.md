---
work_package_id: WP02
title: Policy Evaluation Engine and Deny-by-Default
lane: "done"
dependencies:
- WP01
base_branch: 023-command-policy-engine-and-approval-workflows-WP01
base_commit: ea3eecd927fa6313ae0974c5e175c17767819a74
created_at: '2026-03-01T13:35:28.402260+00:00'
subtasks:
- T006
- T007
- T008
- T009
- T010
phase: Phase 1 - Policy Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "80143"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Policy Evaluation Engine and Deny-by-Default

## Objectives & Success Criteria

- Implement the policy evaluation engine as a central checkpoint for all agent-mediated commands.
- Integrate evaluation into both lane execution and terminal command dispatch.
- Record every evaluation result to the audit sink.
- Verify deny-by-default with randomized testing.

Success criteria:
- 100% of agent-mediated commands are evaluated against policy before execution.
- Unclassified commands are denied in 100% of 1000 randomized test inputs.
- Evaluation latency < 50ms (p95) for up to 500 rules.
- Audit trail contains a record for every evaluation.
- Operator direct commands bypass approval but still produce audit entries.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/023-command-policy-engine-and-approval-workflows/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/023-command-policy-engine-and-approval-workflows/spec.md`
- WP01 output: PolicyRule, PolicyRuleSet, PolicyStorage.

Constraints:
- Evaluation must not block the execution hot path for safe commands (< 50ms).
- Deny-by-default is mandatory.
- Operator commands bypass approval but audit-log.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T006 - Implement PolicyEvaluationEngine

- Purpose: Centralize all policy evaluation logic into a single engine that consumes command context and returns a classification decision.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/engine.ts`.
  2. Implement `PolicyEvaluationEngine` class that:
     - Accepts `PolicyStorage` as a dependency (injected).
     - Exposes `evaluate(command: string, context: CommandContext): PolicyEvaluationResult`.
     - Loads the appropriate workspace rule set from storage.
     - Delegates to `PolicyRuleSet.evaluate()` for pattern matching and classification.
     - Records evaluation timing (start/end timestamps).
     - Returns `PolicyEvaluationResult` with: classification, matched rules, evaluation duration, deny-by-default flag.
  3. Handle edge cases:
     - If storage is unavailable, deny the command (fail-closed).
     - If the workspace has no rules, deny by default.
     - If the command context indicates direct operator input (`isDirect: true`), return `"safe"` classification but flag `bypassedApproval: true` for audit.
  4. Export the engine for integration by lane execution and terminal dispatch modules.
  5. Add logging for denied commands at warn level, approved at debug level.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/engine.ts`
- Acceptance:
  - Engine correctly evaluates commands using workspace-scoped rules.
  - Fail-closed on storage unavailability.
  - Operator bypass flagged for audit.
  - Evaluation timing recorded.
- Parallel: No.

### Subtask T007 - Integrate policy evaluation into lane execution pipeline

- Purpose: Ensure every command executed via lane-based agent workflows is policy-checked before execution.
- Steps:
  1. Identify the lane execution entry point in `apps/runtime/src/integrations/exec.ts` or the appropriate lane execution module.
  2. Add a pre-execution hook that calls `PolicyEvaluationEngine.evaluate()` with the command and lane context.
  3. On `"safe"` classification: proceed with execution immediately.
  4. On `"needs-approval"` classification: create an ApprovalRequest (WP03) and suspend the lane execution until resolved.
  5. On `"blocked"` classification: reject the command immediately with a structured error message including the matching rule and reason.
  6. Ensure the hook does not add measurable latency for safe commands (< 50ms overhead).
  7. Publish a `policy.evaluation.completed` event on the bus with the evaluation result.
  8. Test: verify a safe command through lane execution has minimal added latency.
  9. Test: verify a blocked command through lane execution is rejected with clear diagnostics.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/integrations/exec.ts` (or equivalent)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/engine.ts` (integration)
- Acceptance:
  - All lane-executed commands pass through policy evaluation.
  - Safe commands execute without perceptible delay.
  - Blocked commands produce clear rejection messages.
- Parallel: No.

### Subtask T008 - Integrate policy evaluation into terminal command dispatch

- Purpose: Ensure terminal commands issued by agents (not direct operator input) are policy-checked.
- Steps:
  1. Identify the terminal command dispatch path in the runtime where agent-initiated terminal commands are processed.
  2. Add a pre-dispatch hook that calls `PolicyEvaluationEngine.evaluate()` with the command and terminal/session context.
  3. Handle the three classifications as in T007 (safe: proceed, needs-approval: queue, blocked: reject).
  4. Distinguish between agent-initiated and operator-initiated commands using the `isDirect` flag in context.
  5. Operator-initiated commands bypass approval but still produce audit entries.
  6. Ensure the dispatch hook is on the critical path for agent commands but does not interfere with operator commands.
  7. Test: verify agent terminal command is policy-evaluated.
  8. Test: verify direct operator terminal command bypasses approval but is audit-logged.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/sessions/` (terminal dispatch module)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/engine.ts` (integration)
- Acceptance:
  - Agent terminal commands are policy-evaluated.
  - Operator commands bypass approval.
  - Both produce audit entries.
- Parallel: No.

### Subtask T009 - Wire evaluation results to audit sink

- Purpose: Ensure every policy evaluation is recorded in the audit trail for forensic analysis.
- Steps:
  1. After each evaluation in `PolicyEvaluationEngine`, create a `PolicyEvaluationAuditEvent` with:
     - `eventType`: "policy.evaluation"
     - `actor`: agent ID or operator ID
     - `command`: the evaluated command text
     - `classification`: the result classification
     - `matchedRules`: array of matched rule IDs
     - `denyByDefault`: boolean flag
     - `evaluationDurationMs`: number
     - `workspaceId`, `laneId`, `sessionId` from context
     - `correlationId` from the originating command
  2. Write the event to the audit sink (spec 024) asynchronously (must not block evaluation).
  3. Ensure the audit write never fails silently: if the sink is unavailable, buffer the event and retry.
  4. Verify audit completeness: every evaluation produces exactly one audit event.
  5. Test: verify audit events are written for safe, blocked, and needs-approval evaluations.
  6. Test: verify audit events are written for operator-bypassed commands.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/engine.ts` (audit integration)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/audit/` (event type registration)
- Acceptance:
  - Every evaluation produces an audit event.
  - Audit writes are async and do not block evaluation.
  - Buffering on sink unavailability.
- Parallel: No.

### Subtask T010 - Deny-by-default verification and performance benchmarks

- Purpose: Prove that deny-by-default holds under randomized inputs and that evaluation performance meets the 50ms p95 target.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/policy/deny-by-default.test.ts`.
  2. Generate 1000 randomized command strings (using random words, paths, and special characters).
  3. Evaluate each against a workspace with known rules (10 safe, 10 needs-approval, 10 blocked).
  4. Verify that any command not matching a rule is classified as `"blocked"` with `denyByDefault: true`.
  5. Verify zero unclassified commands escape as `"safe"`.
  6. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/policy/performance.test.ts`.
  7. Generate a rule set with 500 rules (mix of glob and regex).
  8. Evaluate 1000 commands and measure p95 latency.
  9. Assert p95 < 50ms.
  10. If p95 exceeds target, profile and optimize (pre-compile patterns, reduce iteration).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/policy/deny-by-default.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/policy/performance.test.ts`
- Acceptance:
  - 1000/1000 unmatched commands denied.
  - p95 evaluation latency < 50ms with 500 rules.
  - Zero false allows.
- Parallel: Yes (after T006 engine is functional).

## Test Strategy

- Randomized deny-by-default verification (1000 commands).
- Performance benchmarks with 500 rules.
- Integration tests for lane and terminal dispatch hooks.
- Audit completeness verification.

## Risks & Mitigations

- Risk: Evaluation hook adds latency to safe command execution.
- Mitigation: Pre-compile patterns; in-memory cache; benchmark in CI.
- Risk: Audit sink backpressure causes evaluation blocking.
- Mitigation: Async audit writes with bounded buffer.

## Review Guidance

- Confirm deny-by-default holds for all unmatched commands.
- Confirm operator commands bypass approval but audit-log.
- Confirm evaluation integrates into both lane and terminal paths.
- Confirm performance meets 50ms p95 target.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:35:28Z – claude-haiku – shell_pid=80143 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:36:03Z – claude-haiku – shell_pid=80143 – lane=done – Implemented
