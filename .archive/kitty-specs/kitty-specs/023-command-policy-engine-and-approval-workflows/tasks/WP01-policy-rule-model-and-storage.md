---
work_package_id: WP01
title: Policy Rule Model and Storage
lane: "done"
dependencies: []
base_branch: main
base_commit: b60720e55a9bdcd25f2d7a49039abeb9ee2b33b7
created_at: '2026-03-01T13:34:08.526724+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 1 - Policy Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "73312"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Policy Rule Model and Storage

## Objectives & Success Criteria

- Define the PolicyRule and PolicyRuleSet types with pattern matching, classification, and conflict resolution.
- Implement rule storage with in-memory cache and file-backed persistence.
- Ensure deny-by-default for all unmatched commands.
- Support hot-swap rule updates within 1 second.

Success criteria:
- PolicyRuleSet correctly classifies commands as safe, needs-approval, or blocked.
- Denylist patterns override allowlist patterns in all conflict scenarios.
- Unmatched commands are denied by default.
- Rule updates take effect within 1 second without restart.
- All classification logic is tested with edge cases.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/023-command-policy-engine-and-approval-workflows/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/023-command-policy-engine-and-approval-workflows/spec.md`

Constraints:
- Policy evaluation < 50ms (p95) for up to 500 rules (NFR-023-001).
- Deny-by-default is mandatory; no implicit allow.
- Denylist always wins over allowlist.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Define PolicyRule type

- Purpose: Establish the foundational data model for individual policy rules.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/types.ts`.
  2. Define `PolicyClassification` enum: `"safe"`, `"needs-approval"`, `"blocked"`.
  3. Define `PolicyPatternType` enum: `"glob"`, `"regex"`.
  4. Define `PolicyRule` interface:
     - `id`: unique string identifier
     - `pattern`: string (glob or regex pattern to match against command text)
     - `patternType`: PolicyPatternType
     - `classification`: PolicyClassification
     - `scope`: string (workspace ID this rule applies to)
     - `priority`: number (lower = higher priority, used for ordering)
     - `description`: string (human-readable explanation)
     - `targets`: optional array of path patterns this rule applies to (for file-targeting commands)
     - `createdAt`: ISO 8601 timestamp
     - `updatedAt`: ISO 8601 timestamp
  5. Define `PolicyRuleInput` type for creating/updating rules (omitting computed fields).
  6. Add JSDoc comments explaining each field's purpose and constraints.
  7. Export all types for use by the engine and storage modules.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/types.ts`
- Acceptance:
  - All types exported and documented.
  - Classification enum covers all three states.
  - Pattern type supports both glob and regex.
- Parallel: No.

### Subtask T002 - Implement PolicyRuleSet with denylist-wins conflict resolution

- Purpose: Provide ordered rule evaluation with deterministic conflict resolution.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/rules.ts`.
  2. Implement `PolicyRuleSet` class that holds an ordered array of rules for a workspace.
  3. Implement `evaluate(command: string, context: CommandContext)` method that:
     a. Iterates rules in priority order.
     b. Tests each rule's pattern against the command text (glob via micromatch or regex via RegExp).
     c. If file targets are specified, also tests against the command's affected paths.
     d. Collects all matching rules.
     e. Applies conflict resolution: if any matching rule has classification `"blocked"`, the result is blocked (denylist-wins). Among remaining, most restrictive wins (`needs-approval` > `safe`).
     f. If no rules match, returns `"blocked"` (deny-by-default).
  4. Return a `PolicyEvaluationResult` containing: matched rules, final classification, evaluation duration (ms), and the deny-by-default flag if triggered.
  5. Pre-compile regex patterns on rule load for evaluation performance.
  6. Add `CommandContext` interface: `workspaceId`, `agentId`, `affectedPaths`, `isDirect` (operator vs agent).
  7. Implement `addRule`, `removeRule`, `updateRule` methods that maintain sorted order.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/rules.ts`
- Acceptance:
  - Denylist-wins conflict resolution works correctly.
  - Deny-by-default for unmatched commands.
  - Pre-compiled patterns for performance.
  - Evaluation returns complete result with matched rules.
- Parallel: No.

### Subtask T003 - Implement rule storage with memory cache and file persistence

- Purpose: Persist rules durably while maintaining fast in-memory evaluation.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/storage.ts`.
  2. Implement `PolicyStorage` class with:
     - In-memory cache of `PolicyRuleSet` per workspace.
     - File-backed persistence: rules stored as JSON in a configurable location (e.g., `~/.helios/policies/<workspaceId>.json`).
     - `loadRules(workspaceId)`: read from file, populate cache.
     - `saveRules(workspaceId, rules)`: write to file atomically (temp + rename), update cache.
     - `getRuleSet(workspaceId)`: return cached rule set, loading from file if not cached.
  3. Ensure file writes are atomic: write to temp file, then rename.
  4. Handle missing policy files: return empty rule set (which means deny-by-default for all commands).
  5. Add file watching for external policy edits.
  6. Validate rules on load: reject malformed entries with clear error messages.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/storage.ts`
- Acceptance:
  - Rules persist across process restarts.
  - In-memory cache is kept in sync with file.
  - Atomic writes prevent corruption.
  - Missing files handled gracefully (deny-by-default).
- Parallel: No.

### Subtask T004 - Implement hot-swap rule updates

- Purpose: Allow policy changes to take effect immediately without process restart.
- Steps:
  1. Implement a file watcher in `PolicyStorage` that monitors policy files for changes.
  2. On detected change, reload rules from file and update the in-memory cache.
  3. Ensure the update is atomic: the old rule set is used for evaluations in progress; the new rule set takes effect for the next evaluation.
  4. Add a `PolicyStorage.onRulesChanged(callback)` event for notifying dependent components.
  5. Publish a `policy.rules.updated` event on the local bus when rules change.
  6. Verify the update propagation time is < 1 second from file change to evaluation using new rules.
  7. Handle edge cases: malformed policy file update (reject and keep previous rules), concurrent file modifications.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/policy/storage.ts` (update)
- Acceptance:
  - Rule updates take effect within 1 second.
  - Malformed updates rejected; previous rules preserved.
  - Bus event published on rule change.
- Parallel: No.

### Subtask T005 - Add unit tests for rule model and storage

- Purpose: Lock the policy rule model behavior with comprehensive tests.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/policy/rules.test.ts`.
  2. Test: glob pattern `git *` matches `git status` and `git push` but not `grep git`.
  3. Test: regex pattern `^rm\s+-rf` matches `rm -rf /tmp` but not `echo rm -rf`.
  4. Test: denylist-wins: `*.env` blocked + `cat *.env` safe -> result is blocked.
  5. Test: deny-by-default: command matching no rules returns `blocked`.
  6. Test: priority ordering: higher-priority (lower number) rules evaluated first.
  7. Test: file target matching: rule targeting `*.env` matches command affecting `.env` files.
  8. Test: evaluation duration < 50ms for 500 rules (performance benchmark).
  9. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/policy/storage.test.ts`.
  10. Test: rules persist to file and reload correctly.
  11. Test: atomic write survives simulated crash (check temp file cleanup).
  12. Test: hot-swap: update file, verify new rules used within 1 second.
  13. Test: malformed file rejected; previous rules preserved.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/policy/rules.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/policy/storage.test.ts`
- Acceptance:
  - All rule matching, conflict resolution, and storage scenarios tested.
  - Performance benchmark passes.
  - Tests are deterministic.
- Parallel: Yes (after T001-T004 interfaces are defined).

## Test Strategy

- Vitest unit tests for rule matching, conflict resolution, and storage.
- Performance benchmarks for evaluation latency.
- Deterministic tests with no flakiness.

## Risks & Mitigations

- Risk: Complex regex patterns slow evaluation.
- Mitigation: Pre-compile; benchmark; limit pattern complexity.
- Risk: File watcher misses rapid sequential updates.
- Mitigation: Debounce file watch events; test with rapid updates.

## Review Guidance

- Confirm deny-by-default is enforced for unmatched commands.
- Confirm denylist-wins in all conflict scenarios.
- Confirm hot-swap < 1 second.
- Confirm no suppression directives.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:34:08Z – claude-haiku – shell_pid=73312 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:35:22Z – claude-haiku – shell_pid=73312 – lane=done – Implemented
