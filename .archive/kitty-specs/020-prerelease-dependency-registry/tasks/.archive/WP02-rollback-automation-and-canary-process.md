---
work_package_id: WP02
title: Rollback Automation and Canary Upgrade Process
lane: "planned"
dependencies:
- WP01
base_branch: main
base_commit: ""
created_at: '2026-02-27T00:00:00+00:00'
subtasks:
- T005
- T006
- T007
- T008
phase: Phase 1 - Automation
assignee: ''
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Rollback Automation and Canary Upgrade Process

## Objectives & Success Criteria

- Deliver atomic rollback that restores the last known-good pin and lockfile state for any tracked dependency.
- Deliver a canary upgrade process that tests prerelease bumps in isolation against the full quality gate suite.
- Ensure every upgrade attempt and rollback is recorded in the structured changelog.

Success criteria:
- Rollback completes in under 60 seconds including lockfile regeneration.
- Rollback is atomic: either full reversion succeeds or no lockfile changes persist.
- Canary auto-merges passing upgrades and opens issues for failing upgrades.
- Every upgrade attempt (success or failure) has a changelog entry with timestamp, versions, gate results, and actor.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/020-prerelease-dependency-registry/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/020-prerelease-dependency-registry/spec.md`
- WP01 artifacts: `deps-registry.json`, `deps-changelog.json`, `scripts/deps-changelog-util.ts`
- Quality gates: spec 021 gate suite (`bun run gates`)

Constraints:
- Canary must not block or delay unrelated CI pipelines.
- Rollback restores the full lockfile snapshot, not just the single pin.
- Zero unreviewed prerelease upgrades may reach main.
- Keep script files under 350 lines each.

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T005 - Implement deps:rollback with atomic lockfile reversion

- Purpose: enable developers to quickly recover from a breaking prerelease upgrade.
- Steps:
  1. Create `scripts/deps-rollback.ts` as the entry point for `bun run deps:rollback <package>`.
  2. Register the script in root `package.json` under `"scripts"`.
  3. The script must:
     - Accept a package name argument and validate it exists in `deps-registry.json`.
     - Look up the last known-good version from the `knownGoodHistory` array.
     - If no known-good version exists, exit with an error and actionable message.
     - Create a backup of the current lockfile before making changes.
     - Update the dependency pin in `deps-registry.json` to the known-good version.
     - Update `package.json` and/or workspace `package.json` files that reference the dependency.
     - Run `bun install` to regenerate the lockfile with the reverted pin.
     - Verify the lockfile was regenerated successfully.
     - If any step fails, restore the lockfile backup and undo manifest changes (atomicity).
     - Record the rollback event in `deps-changelog.json` via the changelog utility.
  4. Support `--dry-run` flag that shows what would change without modifying files.
  5. Exit with code 0 on success, code 1 on failure.
  6. Measure and log the total rollback duration.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-rollback.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (add script)
- Acceptance:
  - Rollback to known-good pin restores a passing `bun run gates` suite.
  - Rollback completes in under 60 seconds.
  - Failed rollback leaves the lockfile in its pre-rollback state (atomicity).
  - Changelog contains a rollback entry with correct metadata.
- Parallel: No.

### Subtask T006 - Implement deps:canary upgrade automation

- Purpose: automate the detection, testing, and safe merging of prerelease dependency upgrades.
- Steps:
  1. Create `scripts/deps-canary.ts` as the entry point for the canary process.
  2. Register the script in root `package.json` under `"scripts"`.
  3. The canary process must:
     - Read `deps-registry.json` and check each tracked dependency for available upgrades.
     - For each available upgrade:
       a. Create an isolated branch named `canary/<package>-<version>`.
       b. Update the dependency pin in the manifest and workspace `package.json`.
       c. Run `bun install` to regenerate the lockfile.
       d. Run the full quality gate suite (`bun run gates`).
       e. If all gates pass:
          - Record a `canary_pass` entry in the changelog.
          - Update `knownGoodHistory` with the new version.
          - Auto-merge the canary branch to the target branch (configurable, default: main).
          - Add a changelog entry to the commit message.
       f. If any gate fails:
          - Record a `canary_fail` entry in the changelog with failure details.
          - Open a GitHub issue with: package name, from/to versions, failing gates, error output.
          - Do not merge; leave the branch for manual investigation.
  4. Support `--package <name>` to run canary for a single dependency.
  5. Support `--dry-run` to show what would be tested without creating branches.
  6. Log all actions to stdout with timestamps for observability.
  7. Ensure the canary process is safe to run concurrently with normal development (isolated branches).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-canary.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (add script)
- Acceptance:
  - Canary detects available upgrades and tests them in isolation.
  - Passing upgrades are auto-merged with changelog entries.
  - Failing upgrades produce GitHub issues with actionable failure details.
  - Canary does not block unrelated CI pipelines.
- Parallel: No.

### Subtask T007 - Wire canary and rollback events into changelog

- Purpose: ensure complete audit trail of all dependency management actions.
- Steps:
  1. Integrate the changelog append utility from WP01 into both `deps-rollback.ts` and `deps-canary.ts`.
  2. Ensure rollback events include: `type: "rollback"`, from/to versions, reason, and actor.
  3. Ensure canary pass events include: `type: "canary_pass"`, from/to versions, gate results summary, and merge commit SHA.
  4. Ensure canary fail events include: `type: "canary_fail"`, from/to versions, failing gate names, error snippets, and issue URL.
  5. Ensure upgrade attempt events are recorded BEFORE the attempt starts (for traceability of in-progress operations).
  6. Verify that the changelog correctly reflects the sequence of events for a full canary cycle.
  7. Add a `bun run deps:log` convenience command that pretty-prints the changelog for human review.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-rollback.ts` (integrate changelog)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-canary.ts` (integrate changelog)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-log.ts` (new convenience script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (add deps:log script)
- Acceptance:
  - Every rollback and canary action produces a changelog entry.
  - `bun run deps:log` displays a readable history of all dependency management events.
  - Changelog entries are ordered chronologically and schema-valid.
- Parallel: No.

### Subtask T008 - Add integration tests for rollback, canary, and changelog

- Purpose: validate the complete dependency management workflow with automated tests.
- Steps:
  1. Create `scripts/tests/deps-rollback.test.ts` with tests for:
     - Successful rollback to known-good version with lockfile regeneration.
     - Atomic rollback: simulate a `bun install` failure and verify lockfile is restored.
     - Rollback with no known-good version: verify helpful error message.
     - Rollback produces a changelog entry with correct metadata.
     - `--dry-run` shows changes without modifying files.
     - Rollback duration is under 60 seconds (performance assertion).
  2. Create `scripts/tests/deps-canary.test.ts` with tests for:
     - Canary detects available upgrade and creates isolated branch.
     - Canary with passing gates: auto-merges and records `canary_pass` changelog entry.
     - Canary with failing gates: opens issue and records `canary_fail` entry (mock GitHub API).
     - Canary with unreachable registry: skips check and logs connectivity failure.
     - `--dry-run` shows what would be tested without creating branches.
     - `--package` flag filters to single dependency.
  3. Create `scripts/tests/deps-log.test.ts` with tests for:
     - Log command formats changelog entries readably.
     - Empty changelog produces appropriate message.
     - Large changelog (100+ entries) renders without timeout.
  4. Mock `bun install`, `bun run gates`, and GitHub API calls for deterministic testing.
  5. Use temp directories for lockfile operations to avoid polluting the real workspace.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-rollback.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-canary.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-log.test.ts`
- Acceptance:
  - All tests pass with `bun test`.
  - Tests cover happy path, error paths, atomicity, and edge cases.
  - Mocked external calls enable deterministic, offline testing.
  - No suppression directives in test files.
- Parallel: Yes (after T005-T007 interfaces are defined).

## Test Strategy

- Vitest for all tests with mocked external dependencies.
- Temp directories for lockfile operations to avoid workspace pollution.
- Performance assertions for rollback duration.
- Edge case coverage: concurrent upgrades, missing known-good, registry unreachability, channel disappearance.
- Mock GitHub API for issue creation and branch merge operations.

## Risks & Mitigations

- Risk: Canary branch conflicts with concurrent development branches.
- Mitigation: Isolated branch naming convention (`canary/<package>-<version>`); auto-rebase on conflict.
- Risk: Lockfile regeneration takes longer than 60 seconds for large dependency trees.
- Mitigation: Measure in CI; optimize if needed; document workarounds.
- Risk: Canary auto-merge races with manual merges on the same dependency.
- Mitigation: Canary checks for concurrent in-progress canaries before starting.

## Review Guidance

- Confirm rollback is truly atomic: failed rollback leaves lockfile unchanged.
- Confirm canary creates properly isolated branches that do not interfere with development.
- Confirm every action produces a changelog entry before and after execution.
- Confirm canary respects the "zero unreviewed upgrades on main" constraint.
- Confirm all external calls (registry, git, GitHub API) are mocked in tests.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
