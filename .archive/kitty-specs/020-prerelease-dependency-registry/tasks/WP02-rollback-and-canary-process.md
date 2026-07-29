---
work_package_id: WP02
title: Rollback Automation, Canary Upgrade Process, and Tests
lane: "done"
dependencies:
- WP01
base_branch: 020-prerelease-dependency-registry-WP01
base_commit: 9c9e923a078db724d846fc05a09523d0187f345c
created_at: '2026-03-01T13:31:46.174773+00:00'
subtasks:
- T006
- T007
- T008
- T009
- T010
- T011
phase: Phase 1 - Dependency Tracking
assignee: ''
agent: "claude-haiku"
shell_pid: "64058"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Rollback Automation, Canary Upgrade Process, and Tests

## Objectives & Success Criteria

- Deliver atomic rollback to the last known-good pin for any tracked prerelease dependency.
- Deliver a canary upgrade process that tests prerelease bumps in isolation before merging.
- Ensure every upgrade attempt (success or failure) is recorded in the structured changelog.
- Comprehensive integration tests for both rollback and canary workflows.

Success criteria:
- `bun run deps:rollback <package>` reverts to last known-good pin atomically with passing gates.
- Canary process creates an isolated branch, upgrades, runs all gates, and auto-merges or opens issue.
- Every upgrade attempt is recorded in `deps-changelog.json`.
- Rollback completes in < 60 seconds including lockfile regeneration.
- Canary does not block unrelated CI pipelines.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/020-prerelease-dependency-registry/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/020-prerelease-dependency-registry/spec.md`
- WP01 output: `deps-registry.json`, `deps-changelog.json`, `scripts/deps-types.ts`, `scripts/deps-status.ts`, `scripts/deps-changelog-util.ts`.

Constraints:
- Rollback must be atomic: full reversion or no changes (FR-005).
- Canary must not block unrelated CI (NFR-003).
- Per-workspace deterministic pinning must be maintained (FR-003).
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T006 - Implement atomic rollback command

- Purpose: Provide a single command to safely revert a breaking prerelease dependency to the last known-good pin.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-rollback.ts`.
  2. Accept a package name as a required CLI argument: `bun run deps:rollback <package>`.
  3. Read `deps-registry.json` and locate the target dependency entry.
  4. Extract the most recent entry from `knownGoodHistory` that is different from the current pin.
  5. Implement atomic rollback:
     a. Copy the current lockfile to a backup location.
     b. Update `package.json` (root and/or workspace) to pin the target dependency to the known-good version.
     c. Run `bun install` to regenerate the lockfile.
     d. Run `bun run typecheck` as a smoke check.
     e. If typecheck passes: update `deps-registry.json` currentPin to the rollback version, append a changelog entry via the utility from WP01.
     f. If typecheck fails or any step fails: restore the backup lockfile and revert package.json changes. Print error with details.
  6. Ensure only the target dependency changes in the lockfile — diff the lockfile before committing to verify no unrelated changes.
  7. Handle edge cases: package not found in manifest, no known-good version available, lockfile backup/restore failures.
  8. Add `deps:rollback` script entry to root `package.json`.
  9. Print a summary: rolled back from version X to version Y, gates passed/failed, changelog entry ID.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-rollback.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (script entry)
- Acceptance:
  - Rollback reverts to known-good pin with passing typecheck.
  - Atomic: failure at any step restores original state.
  - Completes in < 60 seconds including lockfile regen.
  - Changelog entry recorded.
- Parallel: No.

### Subtask T007 - Implement canary upgrade process

- Purpose: Automate the testing of prerelease upgrades in isolation so safe upgrades are merged automatically and risky ones are flagged.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-canary.ts`.
  2. Accept optional package name argument; if omitted, check all tracked dependencies for available upgrades.
  3. For each dependency with an available upgrade:
     a. Create an isolated git branch: `canary/<package>-<version>-<timestamp>`.
     b. Update the dependency pin in the appropriate `package.json`.
     c. Run `bun install` to regenerate the lockfile.
     d. Run the full quality gate suite via `bun run gates` (spec 021).
     e. Collect structured gate results (JSON output from each gate).
  4. On all gates passing:
     a. Commit the changes with a structured message: `chore(deps): upgrade <package> from <old> to <new> [canary]`.
     b. Push the branch and create a PR targeting the configured base branch.
     c. If auto-merge is enabled, merge the PR.
     d. Update `deps-registry.json`: set new currentPin, add to knownGoodHistory.
     e. Append a success entry to `deps-changelog.json`.
  5. On any gate failing:
     a. Do not merge. Open a GitHub issue with: package name, attempted version, failing gates with details, and the canary branch ref.
     b. Append a failure entry to `deps-changelog.json` with gate failure details.
  6. Ensure the canary process runs in its own CI job/context and does not block other pipelines.
  7. Support a `--dry-run` flag that reports what would be upgraded without making changes.
  8. Handle edge cases: no upgrades available (exit 0 with message), git branch conflicts, CI timeout.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-canary.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (script entry)
- Acceptance:
  - Canary creates isolated branch, runs gates, merges on pass, opens issue on fail.
  - Structured changelog entries for all outcomes.
  - Does not block unrelated CI pipelines.
  - Dry-run mode works without side effects.
- Parallel: No.

### Subtask T008 - Wire canary results into changelog

- Purpose: Ensure every canary run outcome is recorded in the structured dependency changelog for auditability.
- Steps:
  1. Import and use the `appendChangelogEntry` utility from `scripts/deps-changelog-util.ts` in the canary script.
  2. On canary success: record entry with `outcome: "success"`, all gate results, branch ref, and PR URL.
  3. On canary failure: record entry with `outcome: "failure"`, failing gate details, issue URL.
  4. On canary skip (no upgrade available): record entry with `outcome: "skipped"` and reason.
  5. Verify changelog entries are appended atomically even when multiple canary runs execute concurrently.
  6. Add a `bun run deps:log` convenience command that pretty-prints the changelog.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-canary.ts` (integration)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-changelog-util.ts` (may need updates)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (deps:log script entry)
- Acceptance:
  - Every canary outcome produces a changelog entry.
  - Changelog entries are complete and valid per schema.
  - `bun run deps:log` displays the changelog readably.
- Parallel: No.

### Subtask T009 - Add rollback integration tests

- Purpose: Validate the rollback workflow end-to-end with simulated dependency breakage.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-rollback.test.ts`.
  2. Test: given a manifest with a known-good history, rollback to the previous pin updates the manifest and lockfile correctly.
  3. Test: given a rollback where lockfile regeneration fails, the original lockfile is restored and no manifest changes are persisted.
  4. Test: given a package not in the manifest, rollback exits with a clear error and no file changes.
  5. Test: given a package with no known-good history (only one version ever), rollback exits with a clear error.
  6. Test: given a successful rollback, a changelog entry is appended with correct fields.
  7. Test: lockfile diff after rollback shows only the target dependency changed.
  8. Use fixture files and mocked `bun install` / `bun run typecheck` to make tests deterministic and fast.
  9. Ensure tests clean up any temporary files or backup copies.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-rollback.test.ts`
- Acceptance:
  - All rollback scenarios covered (success, failure, edge cases).
  - Tests are deterministic and fast.
  - No flakiness or leftover artifacts.
- Parallel: Yes (after T006 is functional).

### Subtask T010 - Add canary integration tests

- Purpose: Validate the canary upgrade workflow end-to-end with simulated upgrade scenarios.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-canary.test.ts`.
  2. Test: given an available upgrade that passes all gates, the canary creates a branch, commits, and records a success changelog entry.
  3. Test: given an available upgrade that fails a gate, the canary does not merge, opens an issue, and records a failure changelog entry.
  4. Test: given no available upgrades, the canary exits cleanly with a skip changelog entry.
  5. Test: dry-run mode reports the planned upgrade without creating branches or modifying files.
  6. Test: canary handles git branch naming conflicts gracefully.
  7. Test: canary handles registry unreachable gracefully (skip with warning).
  8. Mock git operations, CI gate execution, and GitHub API calls for deterministic testing.
  9. Verify the canary process does not modify the working directory of unrelated CI jobs.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-canary.test.ts`
- Acceptance:
  - All canary scenarios covered (pass, fail, skip, dry-run, errors).
  - Tests are deterministic via mocking.
  - No side effects on the host filesystem or git state.
- Parallel: Yes (after T007 is functional).

### Subtask T011 - Validate NFR performance compliance

- Purpose: Confirm the rollback and canary workflows meet the non-functional requirements for speed and isolation.
- Steps:
  1. Measure rollback execution time including lockfile regeneration and verify < 60 seconds.
  2. Measure status command execution time with warm cache and verify < 10 seconds.
  3. Verify canary runs in isolation: start an unrelated CI job concurrently and confirm it is not blocked or delayed.
  4. Document all measurements with environment details.
  5. If any NFR is not met, identify the bottleneck and document mitigation.
- Files:
  - No new files; measurements documented in PR description.
- Acceptance:
  - All NFR targets met or documented with mitigation plans.
- Parallel: No.

## Test Strategy

- Vitest integration tests with mocked external dependencies (git, registries, CI).
- Fixture-based rollback tests with known-good and failure scenarios.
- Deterministic canary tests via mocked gate execution.
- Performance measurements for NFR compliance.

## Risks & Mitigations

- Risk: Lockfile regeneration changes unrelated dependencies.
- Mitigation: Diff lockfile before/after; reject if non-target dependencies changed.
- Risk: Canary branch conflicts with existing branches.
- Mitigation: Include timestamp in branch name; handle conflict by appending suffix.

## Review Guidance

- Confirm rollback is truly atomic (no partial state on failure).
- Confirm canary runs in isolation without blocking other CI.
- Confirm all changelog entries are complete and schema-valid.
- Confirm edge cases are handled (missing package, no history, unreachable registry).

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:31:46Z – claude-haiku – shell_pid=64058 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:33:19Z – claude-haiku – shell_pid=64058 – lane=done – Implemented
