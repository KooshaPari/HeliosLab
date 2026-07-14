---
work_package_id: WP01
title: GCA/CodeRabbit Configuration and Review Requirements
lane: "done"
dependencies: []
base_branch: main
base_commit: c0c76ff4c8f9336ace18d5c5929a53f91b36e7a8
created_at: '2026-03-01T13:29:52.919126+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
phase: Phase 1 - Review Infrastructure
assignee: ''
agent: "claude-haiku"
shell_pid: "55460"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - GCA/CodeRabbit Configuration and Review Requirements

## Objectives & Success Criteria

- Configure GitHub branch protection with GCA and CodeRabbit as required status checks.
- Enforce agent review approval as a merge prerequisite.
- Implement self-merge gating tied to all gates passing and all reviews approved.
- Establish an append-only governance log recording every merge with full provenance.

Success criteria:
- Merge is blocked until GCA, CodeRabbit, and agent review all pass/approve.
- Self-merge works only when all gates and reviews are satisfied.
- Rate-limited review tools block merge with retry notification.
- Governance log contains an entry for every merge to main.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/022-code-review-and-governance-process/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/022-code-review-and-governance-process/spec.md`

Constraints:
- No unreviewed merges to main (constitution requirement).
- Rate-limited tools block merge; no skip path.
- Governance log is append-only and version-controlled.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Configure GitHub branch protection rules

- Purpose: Enforce merge requirements at the GitHub level so they cannot be bypassed locally.
- Steps:
  1. Document the required branch protection settings in `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/branch-protection.md`.
  2. Settings must include:
     - Required status checks: `quality-gates` (from spec 021), `gca-review`, `coderabbit-review`, `compliance-check` (WP02).
     - Required pull request reviews: at least 1 approval from a designated reviewer (agent or human).
     - Dismiss stale reviews on new pushes.
     - Require linear history (no merge commits).
     - Restrict who can push directly to `main` (no direct pushes).
  3. Document the settings as a reproducible configuration that can be applied via GitHub API or UI.
  4. Include instructions for setting up branch protection in new forks or mirrors.
  5. Add a validation script or checklist that verifies branch protection is correctly configured.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/branch-protection.md`
- Acceptance:
  - Branch protection settings documented and reproducible.
  - All required status checks listed.
  - Direct pushes to main blocked.
- Parallel: No.

### Subtask T002 - Configure GCA as required status check with retry

- Purpose: Integrate GCA (GitHub Code Analysis or equivalent) as a required automated review gate.
- Steps:
  1. Research and document the GCA integration method (GitHub App, Action, or webhook).
  2. Create the necessary configuration files (e.g., `.github/gca.yml` or equivalent).
  3. Configure GCA to trigger automatically on PR creation and update.
  4. Implement retry logic for rate-limiting: if GCA returns a rate-limit response, wait with exponential backoff (1m, 2m, 4m, max 15m) and retry.
  5. If GCA is unavailable after max retries, the status check remains in "pending" state (blocking merge).
  6. Notify the PR author when GCA is rate-limited or unavailable.
  7. Document the GCA configuration and failure handling in `.github/branch-protection.md`.
  8. Test: open a PR, verify GCA triggers within 5 minutes, verify merge is blocked until GCA passes.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/gca.yml` (or equivalent config)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/branch-protection.md` (update)
- Acceptance:
  - GCA triggers on PR creation/update.
  - Rate-limiting handled with retry and author notification.
  - Merge blocked when GCA has not passed.
- Parallel: No.

### Subtask T003 - Configure CodeRabbit as required status check with retry

- Purpose: Integrate CodeRabbit as a required automated review gate for defense-in-depth.
- Steps:
  1. Research and document the CodeRabbit integration method for the repository.
  2. Create the necessary configuration files (e.g., `.coderabbit.yaml`).
  3. Configure CodeRabbit to trigger on PR creation and update.
  4. Implement retry logic for rate-limiting, mirroring the GCA approach from T002.
  5. If CodeRabbit is unavailable, the status check remains pending (blocking merge).
  6. Notify the PR author on rate-limiting or unavailability.
  7. Document in `.github/branch-protection.md`.
  8. Test: open a PR, verify CodeRabbit triggers, verify merge is blocked until CodeRabbit passes.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.coderabbit.yaml` (or equivalent config)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/branch-protection.md` (update)
- Acceptance:
  - CodeRabbit triggers on PR events.
  - Rate-limiting handled with retry.
  - Merge blocked until CodeRabbit passes.
- Parallel: No.

### Subtask T004 - Implement self-merge gating logic

- Purpose: Allow authors to self-merge only when all quality gates and all review requirements are satisfied.
- Steps:
  1. Define the self-merge preconditions: all spec 021 quality gates pass, GCA approved, CodeRabbit approved, at least one agent review approved.
  2. Implement the gating logic as a GitHub Action or webhook that checks all preconditions before enabling the merge button.
  3. If any precondition is not met, display a clear message indicating which requirement is missing.
  4. When all preconditions are met, allow the author to merge without additional approval.
  5. On self-merge, record the merge in the governance log with a `selfMerge: true` flag.
  6. Test: attempt self-merge with missing agent review, verify blocked.
  7. Test: attempt self-merge with all requirements met, verify allowed.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/self-merge-gate.yml` (or integrated into existing workflow)
- Acceptance:
  - Self-merge allowed only with full attestation.
  - Missing requirements produce clear messages.
  - Governance log records self-merge events.
- Parallel: No.

### Subtask T005 - Create governance log schema and file

- Purpose: Establish an append-only, version-controlled record of every merge to main for auditability.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/governance-log.jsonl` as an empty file.
  2. Define the log entry schema in TypeScript (`scripts/governance-types.ts`):
     - `prNumber`: number
     - `title`: string
     - `author`: string
     - `reviewers`: array of `{name, role, decision}`
     - `gateResults`: object with per-gate pass/fail
     - `complianceAttestation`: boolean (from compliance checker)
     - `exceptionADRs`: array of ADR references (empty if none)
     - `selfMerge`: boolean
     - `mergeCommitSha`: string
     - `timestamp`: ISO 8601
  3. The file uses JSON Lines format (one JSON object per line) for efficient append and line-based querying.
  4. Document the schema in code comments and in `.github/branch-protection.md`.
  5. Add the governance log to `.gitignore` exclusion (ensure it IS tracked, not ignored).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/governance-log.jsonl`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/governance-types.ts`
- Acceptance:
  - JSONL file exists and is version-controlled.
  - Schema is complete and documented.
  - TypeScript types match the schema.
- Parallel: No.

### Subtask T006 - Implement governance log utility

- Purpose: Provide a scriptable interface for appending entries and querying the governance log.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/governance-log.ts`.
  2. Implement `appendGovernanceEntry(entry)` that validates the entry against the schema and appends to `governance-log.jsonl`.
  3. Implement query functions: `getSelfMerges(days)`, `getExceptionADRs()`, `getEntriesByAuthor(name)`, `getEntriesInRange(from, to)`.
  4. Implement `validateGovernanceLog()` that reads all entries and confirms they conform to the schema (useful for CI).
  5. Add `governance:query` script to root `package.json` for command-line querying.
  6. Ensure append is atomic (write to temp, rename).
  7. Test: append a valid entry, query it back, verify fields.
  8. Test: append an invalid entry, verify rejection.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/governance-log.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (governance:query script)
- Acceptance:
  - Entries appended atomically with schema validation.
  - Query functions return correct results.
  - Validation catches malformed entries.
- Parallel: Yes (after T005 schema is defined).

## Test Strategy

- Integration tests: open PRs, verify merge blocking behavior.
- Unit tests for governance log append and query.
- Manual verification of branch protection settings.

## Risks & Mitigations

- Risk: GCA/CodeRabbit rate limits cause persistent merge blocks.
- Mitigation: Retry with exponential backoff; notify author.
- Risk: Governance log grows large over time.
- Mitigation: JSONL format enables efficient line-based access; rotation is a slice-2 concern.

## Review Guidance

- Confirm merge is blocked until all three reviews (GCA, CodeRabbit, agent) pass.
- Confirm self-merge requires full attestation.
- Confirm governance log entries have all required fields.
- Confirm rate-limit handling blocks merge (not skips).

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:29:54Z – claude-haiku – shell_pid=55460 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:32:25Z – claude-haiku – shell_pid=55460 – lane=done – Implemented
