# Work Packages: Code Review and Governance Process

**Inputs**: Design documents from `/kitty-specs/022-code-review-and-governance-process/`
**Prerequisites**: plan.md (required), spec.md (user stories), spec 021 (CI quality gates)

**Tests**: Include explicit testing work because governance enforcement must be verifiable and complete.

**Organization**: Fine-grained subtasks (`Txxx`) roll up into work packages (`WPxx`). Each work package is independently deliverable and testable.

**Prompt Files**: Each work package references a matching prompt file in `/kitty-specs/022-code-review-and-governance-process/tasks/`.

## Subtask Format: `[Txxx] [P?] Description`
- **[P]** indicates the subtask can proceed in parallel (different files/components).
- Subtasks call out concrete paths in `.github/`, `scripts/`, and `docs/`.

---

## Work Package WP01: GCA/CodeRabbit Configuration and Review Requirements (Priority: P0)

**Phase**: Phase 1 - Review Infrastructure
**Goal**: Configure GitHub branch protection, GCA and CodeRabbit as required status checks, agent review requirements, self-merge gating, and the append-only governance log.
**Independent Test**: Open a PR, verify merge is blocked until GCA, CodeRabbit, and agent review all pass. Attempt merge without approval and confirm rejection.
**Prompt**: `/kitty-specs/022-code-review-and-governance-process/tasks/WP01-gca-coderabbit-review-requirements.md`
**Estimated Prompt Size**: ~350 lines

### Included Subtasks
- [x] T001 Configure GitHub branch protection rules for `main`: require status checks (GCA, CodeRabbit, quality-gates), require at least one agent review approval, enforce linear history
- [x] T002 Configure GCA as a GitHub App/integration with required status check, auto-trigger on PR creation and update, and retry logic for rate-limiting
- [x] T003 Configure CodeRabbit as a required status check with auto-trigger and rate-limit retry
- [x] T004 Implement self-merge gating logic: verify all CI gates pass AND all required reviews approved before allowing merge
- [x] T005 Create append-only governance log (`governance-log.jsonl`) with schema: PR number, author, reviewers, gate results, compliance attestation, exception ADRs, timestamp
- [x] T006 [P] Implement `scripts/governance-log.ts` utility for appending entries and querying the log (e.g., self-merges in last 30 days, exception ADRs)

### Implementation Notes
- Branch protection must be documented in `.github/branch-protection.md` for reproducibility.
- Rate-limited review tools block merge; no fallback-to-skip.
- Governance log must be append-only and version-controlled.

### Parallel Opportunities
- T006 can proceed after T005 schema is defined.

### Dependencies
- Depends on spec 021 (CI quality gates as required status checks).

### Risks & Mitigations
- Risk: GCA or CodeRabbit rate limits cause persistent merge blocks.
- Mitigation: Implement exponential backoff retry with notification to author.

---

## Work Package WP02: Constitution Compliance Checker, ADR Exception Workflow, and Tests (Priority: P1)

**Goal**: Deliver a constitution compliance checker that validates every PR against the full review checklist, an ADR exception workflow requiring 3 approvals and sunset dates, and comprehensive tests.
**Independent Test**: Open a PR that violates a constitution requirement, verify the compliance checker flags it with the specific constitution section reference.
**Prompt**: `/kitty-specs/022-code-review-and-governance-process/tasks/WP02-compliance-checker-and-adr-workflow.md`
**Estimated Prompt Size**: ~380 lines

### Included Subtasks
- [x] T007 Implement `scripts/compliance-checker.ts` that validates PR changesets against the constitution review checklist: correctness, tests, docs, types, error handling, performance, security, anti-patterns, library preference, backward-compat avoidance, regression risk
- [x] T008 Implement constitution section referencing: each finding links to the specific section in `docs/reference/constitution.md`
- [x] T009 Create `.github/workflows/compliance-check.yml` GitHub Action that runs the compliance checker on every PR and reports results as a required status check
- [x] T010 Implement ADR exception workflow: validate linked ADRs have sunset dates (or permanence justification), require 3 approvals, store ADRs in `docs/adrs/`
- [x] T011 [P] Add compliance checker unit tests: deliberate violations (missing tests, file > 500 lines, missing types) are caught with correct constitution references
- [x] T012 [P] Add ADR workflow tests: ADR without sunset date rejected, ADR with sunset date and 3 approvals accepted, governance log entry created on merge

### Implementation Notes
- Compliance checker must read the constitution dynamically so amendments are automatically reflected.
- Each finding must include a remediation hint, not just the violation.
- ADR exception workflow integrates with the governance log.

### Parallel Opportunities
- T011 and T012 can proceed after T007 and T010 interfaces are stable.

### Dependencies
- Depends on WP01.

### Risks & Mitigations
- Risk: Constitution amendments change review requirements during open PRs.
- Mitigation: Compliance checker reads constitution at check time; re-evaluation documented as slice-2.

---

## Dependency & Execution Summary

- **Sequence**: WP01 → WP02.
- **Parallelization**: Within WP01, T006 after T005; within WP02, T011/T012 after T007/T010.
- **MVP Scope**: Both WPs required for constitution-compliant governance.

---

## Subtask Index (Reference)

| Subtask ID | Summary | Work Package | Priority | Parallel? |
|------------|---------|--------------|----------|-----------|
| T001 | Branch protection rules | WP01 | P0 | No |
| T002 | GCA integration + retry | WP01 | P0 | No |
| T003 | CodeRabbit integration + retry | WP01 | P0 | No |
| T004 | Self-merge gating logic | WP01 | P0 | No |
| T005 | Governance log schema + file | WP01 | P0 | No |
| T006 | Governance log utility | WP01 | P0 | Yes |
| T007 | Compliance checker implementation | WP02 | P1 | No |
| T008 | Constitution section referencing | WP02 | P1 | No |
| T009 | Compliance check GitHub Action | WP02 | P1 | No |
| T010 | ADR exception workflow | WP02 | P1 | No |
| T011 | Compliance checker tests | WP02 | P1 | Yes |
| T012 | ADR workflow tests | WP02 | P1 | Yes |
