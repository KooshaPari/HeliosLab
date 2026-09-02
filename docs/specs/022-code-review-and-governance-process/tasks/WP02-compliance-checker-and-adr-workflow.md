---
work_package_id: WP02
title: Constitution Compliance Checker, ADR Exception Workflow, and Tests
lane: "done"
dependencies:
- WP01
base_branch: 022-code-review-and-governance-process-WP01
base_commit: bfa4895dec9e139137b85cab60b5c307a37ac4ac
created_at: '2026-03-01T13:32:34.859567+00:00'
subtasks:
- T007
- T008
- T009
- T010
- T011
- T012
phase: Phase 2 - Governance Enforcement
assignee: ''
agent: "claude-haiku"
shell_pid: "67174"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Constitution Compliance Checker, ADR Exception Workflow, and Tests

## Objectives & Success Criteria

- Implement a compliance checker that validates every PR against the full constitution review checklist.
- Each finding references the specific constitution section.
- Implement an ADR exception workflow with sunset dates and 3-approval requirement.
- Comprehensive tests for both the compliance checker and ADR workflow.

Success criteria:
- PRs that violate constitution requirements are flagged with specific section references.
- File size > 500 lines is detected as a violation.
- Missing tests for new code is detected.
- ADRs without sunset dates are rejected.
- ADRs with 3 approvals and sunset dates are accepted.
- Governance log is updated on merge.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/022-code-review-and-governance-process/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/022-code-review-and-governance-process/spec.md`
- WP01 output: branch protection, GCA/CodeRabbit configs, governance log.

Constraints:
- Compliance checker must read the constitution dynamically (amendments reflected immediately).
- Each finding must include remediation hint and constitution section reference.
- ADR exceptions must be time-bounded with sunset dates.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T007 - Implement constitution compliance checker

- Purpose: Validate every PR changeset against the full constitution review checklist to catch violations before merge.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/compliance-checker.ts`.
  2. Read the constitution from `docs/reference/constitution.md` at runtime (not hardcoded) so amendments are reflected immediately.
  3. Parse the review checklist sections from the constitution. Map each section to a programmable check:
     - **Correctness**: verify new functions have return type annotations; verify no unreachable code.
     - **Tests**: verify every new/modified source file has a corresponding test file or test additions.
     - **Types**: verify no `any` type usage; verify strict null checks are respected.
     - **Error handling**: verify try/catch blocks have specific error types; verify no swallowed errors.
     - **Performance**: verify no unbounded loops or synchronous I/O in hot paths.
     - **Security**: verify no hardcoded secrets, credentials, or API keys in source.
     - **File size**: verify no file exceeds 500 lines.
     - **Anti-patterns**: verify no circular imports; verify single-responsibility principle.
  4. Accept a PR diff or file list as input (from CI context or local invocation).
  5. For each check, produce a finding with: check name, file path, line number (where applicable), violation description, constitution section reference, and remediation hint.
  6. Output findings as structured JSON conforming to the gate report schema.
  7. Exit 0 if all checks pass; exit 1 if any violations found.
  8. Support `--json` and table output modes.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/compliance-checker.ts`
- Acceptance:
  - All constitution review checklist items have corresponding checks.
  - Findings include constitution section references.
  - Dynamic constitution reading works.
- Parallel: No.

### Subtask T008 - Implement constitution section referencing

- Purpose: Link each compliance finding to the specific section in the constitution for easy lookup and dispute resolution.
- Steps:
  1. Parse the constitution markdown to extract section headings and their line numbers.
  2. Map each compliance check to its corresponding constitution section by heading match.
  3. Include in each finding: `constitutionSection` (heading text), `constitutionLine` (line number in constitution file).
  4. Format the reference as a clickable link in GitHub PR comments: `[Constitution: Section Name](docs/reference/constitution.md#L<line>)`.
  5. Handle constitution amendments: if a mapped section heading changes, log a warning and fall back to "Section not found" rather than crashing.
  6. Test: verify each check produces a valid section reference.
  7. Test: rename a constitution section, verify the checker handles it gracefully.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/compliance-checker.ts` (integration)
- Acceptance:
  - Every finding includes a constitution section reference.
  - References are formatted as clickable links.
  - Graceful handling of constitution changes.
- Parallel: No.

### Subtask T009 - Create compliance check GitHub Action

- Purpose: Run the compliance checker automatically on every PR as a required status check.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/compliance-check.yml`.
  2. Trigger on `pull_request` events (opened, synchronize, reopened).
  3. Check out the PR branch and the constitution file.
  4. Run the compliance checker against the PR diff.
  5. Post findings as a PR comment with structured formatting.
  6. Set the status check result based on checker exit code.
  7. If the checker finds violations, include the full findings in the PR comment with constitution references.
  8. If the checker passes, post a compliance attestation comment.
  9. Ensure the status check blocks merge on failure.
  10. Configure timeout: 2 minutes for the compliance check.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/compliance-check.yml`
- Acceptance:
  - Action triggers on PR events.
  - Findings posted as PR comment.
  - Status check blocks merge on violations.
  - Completes in < 2 minutes.
- Parallel: No.

### Subtask T010 - Implement ADR exception workflow

- Purpose: Provide a structured process for documenting and approving exceptions to constitution rules.
- Steps:
  1. Create the ADR directory: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/docs/adrs/`.
  2. Create an ADR template at `docs/adrs/TEMPLATE.md` with required fields: title, status (proposed/accepted/superseded), date, constitution section being excepted, justification, sunset date or permanence justification, required approvers (3).
  3. Implement ADR validation logic in the compliance checker:
     - When a PR violates a constitution rule, check if a linked ADR exists in the PR that documents the exception.
     - Validate the ADR has: a sunset date OR explicit permanence justification, at least 3 approvals (from PR review comments or ADR file metadata).
     - If the ADR is valid, accept the exception and note it in the compliance report.
     - If the ADR is invalid (missing sunset date, insufficient approvals), reject the exception.
  4. When a PR with a valid exception is merged, record the ADR in the governance log entry.
  5. Implement ADR expiry tracking: a CI check that scans `docs/adrs/` for ADRs past their sunset date and alerts.
  6. Test: PR with violation + valid ADR + 3 approvals -> compliance passes with exception noted.
  7. Test: PR with violation + ADR missing sunset date -> compliance fails.
  8. Test: PR with violation + no ADR -> compliance fails.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/docs/adrs/TEMPLATE.md`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/compliance-checker.ts` (ADR integration)
- Acceptance:
  - ADR template has all required fields.
  - Compliance checker validates ADR exceptions correctly.
  - Missing sunset dates are rejected.
  - Valid exceptions are recorded in governance log.
- Parallel: No.

### Subtask T011 - Compliance checker unit tests

- Purpose: Verify the compliance checker catches all constitution violation types correctly.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/compliance-checker.test.ts`.
  2. Test: file exceeding 500 lines is flagged with file size constitution reference.
  3. Test: new source file without corresponding test file is flagged.
  4. Test: `any` type usage is flagged with types constitution reference.
  5. Test: swallowed error (empty catch block) is flagged.
  6. Test: hardcoded secret pattern (e.g., `API_KEY = "sk-..."`) is flagged.
  7. Test: clean PR with all requirements met passes compliance.
  8. Test: compliance attestation is generated for passing PRs.
  9. Test: constitution section references are valid and formatted correctly.
  10. Test: dynamic constitution reading picks up simulated amendments.
  11. Use fixture files for each test case.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/compliance-checker.test.ts`
- Acceptance:
  - All violation types tested.
  - All tests pass.
  - Tests are deterministic.
- Parallel: Yes (after T007 is functional).

### Subtask T012 - ADR workflow tests

- Purpose: Verify the ADR exception workflow enforces all requirements correctly.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/adr-workflow.test.ts`.
  2. Test: ADR with sunset date and 3 approvals is accepted as a valid exception.
  3. Test: ADR without sunset date (and no permanence justification) is rejected.
  4. Test: ADR with sunset date but only 2 approvals is rejected.
  5. Test: ADR with explicit permanence justification (no sunset date) is accepted.
  6. Test: merged PR with valid exception produces governance log entry containing the ADR reference.
  7. Test: expired ADR (past sunset date) is detected by the expiry tracker.
  8. Use fixture ADR files and simulated PR contexts.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/adr-workflow.test.ts`
- Acceptance:
  - All ADR scenarios covered.
  - Governance log integration verified.
  - Tests are deterministic.
- Parallel: Yes (after T010 is functional).

## Test Strategy

- Fixture-based compliance checker tests with deliberate violations.
- ADR fixture files for exception workflow testing.
- Constitution section reference validation.
- Governance log integration verified via test merges.

## Risks & Mitigations

- Risk: Constitution format changes break the parser.
- Mitigation: Parser handles missing sections gracefully; unit tests verify robustness.
- Risk: ADR approval count is hard to verify programmatically.
- Mitigation: Use PR review comment count or ADR file metadata; document the verification method.

## Review Guidance

- Confirm all constitution checklist items have corresponding checks.
- Confirm findings include constitution section references with line numbers.
- Confirm ADR exceptions require sunset dates and 3 approvals.
- Confirm governance log entries are created for merges with exceptions.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:32:35Z – claude-haiku – shell_pid=67174 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:34:02Z – claude-haiku – shell_pid=67174 – lane=done – Implemented
