---
work_package_id: WP01
title: Gate Pipeline Definition — Typecheck, Lint, and Test Gates
lane: "done"
dependencies: []
base_branch: main
base_commit: 0640fb9d8f5c4911ea5720f40bf4bf4358fd666a
created_at: '2026-03-01T13:33:24.783799+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
phase: Phase 1 - CI Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "70715"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Gate Pipeline Definition — Typecheck, Lint, and Test Gates

## Objectives & Success Criteria

- Define the GitHub Actions CI workflow skeleton that executes all 8 quality gates in order.
- Implement the first four gates: typecheck, lint, unit tests, and e2e tests.
- Establish structured JSON gate report infrastructure.

Success criteria:
- CI pipeline triggers on push and PR events.
- Gates 1-4 execute in order; failure in any gate fails the pipeline.
- Each gate produces a structured JSON report artifact.
- Deliberate failures in each gate category produce clear diagnostics.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/021-continuous-integration-and-quality-gates/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/021-continuous-integration-and-quality-gates/spec.md`

Constraints:
- All gates at maximum strictness; no ignores or skips (constitution requirement).
- Pipeline must complete in < 10 minutes for typical changeset (NFR-001).
- Gate results must be structured JSON artifacts (NFR-002).
- CI config must be version-controlled in the repo (NFR-004).
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Create GitHub Actions CI workflow skeleton

- Purpose: Establish the pipeline structure that all 8 gates will plug into, with proper triggering, artifact handling, and fail-fast behavior.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml`.
  2. Configure triggers: `push` to all branches, `pull_request` to `main`.
  3. Define a single job `quality-gates` running on `ubuntu-latest` (or configured runner).
  4. Add setup steps: checkout, install Bun (pinned version from spec 019), `bun install`.
  5. Define 8 sequential steps, one per gate, each with a unique step ID: `gate-typecheck`, `gate-lint`, `gate-test`, `gate-e2e`, `gate-coverage`, `gate-security`, `gate-static-analysis`, `gate-bypass-detect`.
  6. Configure each step to produce a JSON report artifact uploaded via `actions/upload-artifact`.
  7. Set `continue-on-error: false` for all gate steps (fail-fast).
  8. Add a final step that aggregates all gate reports into a summary artifact.
  9. Configure timeout per step (e.g., 3 minutes per gate) and job-level timeout (10 minutes total).
  10. Add caching for Bun's global cache and `node_modules` to speed up subsequent runs.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml`
- Acceptance:
  - Workflow triggers on push and PR.
  - All 8 gate steps are defined (even if later gates are placeholder `echo` commands for now).
  - Artifacts are uploaded for each gate report.
  - Timeout and caching configured.
- Parallel: No.

### Subtask T002 - Implement Gate 1: TypeScript strict type check

- Purpose: Enforce TypeScript strict-mode type checking as the first quality gate.
- Steps:
  1. Add the gate step in the CI workflow that runs `bun run typecheck`.
  2. Capture the output and exit code.
  3. On failure: parse `tsc` output to extract file path, line number, and error message for each diagnostic.
  4. Generate a structured JSON gate report with: `gateName: "typecheck"`, `status: "pass"|"fail"`, `findings` array (each with `file`, `line`, `column`, `message`, `code`), and `duration` in milliseconds.
  5. Write the report to a known location for artifact upload.
  6. On success: generate a report with empty findings array.
  7. Ensure the gate uses the same tsconfig as spec 019 with all strict flags.
  8. Test locally: introduce a type error, run the gate step, verify the report contains the error details.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml` (gate step)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/gate-report.ts` (report generation utility)
- Acceptance:
  - Gate fails on any type error with structured report.
  - Gate passes on clean code with empty findings.
  - Report includes file, line, column, message for each finding.
- Parallel: No.

### Subtask T003 - Implement Gate 2: Biome lint/format

- Purpose: Enforce code style and lint rules at maximum strictness.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/biome.json` with maximum strictness configuration.
  2. Enable all recommended and nursery rules that are stable.
  3. Configure formatting rules (indentation, line width, quote style) matching project conventions.
  4. Add Biome as a devDependency in root `package.json`.
  5. Add the gate step in CI workflow running `bun run lint` (which invokes `biome check --error-on-warnings .`).
  6. Parse Biome output to generate structured JSON gate report with file, line, rule name, message, and severity.
  7. If Biome does not cover certain rules needed by the constitution, add ESLint as a secondary check with those specific rules only.
  8. Ensure no `biome-ignore` directives are needed in the existing codebase; fix any violations instead.
  9. Add `lint` script to root `package.json`.
  10. Test: introduce a lint violation, verify the gate fails with the specific rule and location.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/biome.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (devDependency + script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml` (gate step)
- Acceptance:
  - Biome at max strictness with zero violations on clean codebase.
  - Gate fails on any lint violation with structured report.
  - No `biome-ignore` directives in the codebase.
- Parallel: No.

### Subtask T004 - Implement Gate 3: Vitest unit tests

- Purpose: Run all unit test suites and enforce that no tests are skipped, focused, or marked as todo.
- Steps:
  1. Ensure `vitest.config.ts` is configured at the root level for monorepo test execution across all workspace packages.
  2. Add the gate step in CI workflow running `bun run test` (which invokes Vitest).
  3. Configure Vitest to fail on `.skip`, `.only`, and `.todo` markers by using a custom reporter or pre-test scan.
  4. Parse Vitest output to generate structured JSON gate report with: test name, suite name, file path, status (pass/fail/skip), duration, and failure message if applicable.
  5. Add `test` script to root `package.json` that runs Vitest across all workspace packages.
  6. Ensure tests run deterministically with no flakiness tolerance.
  7. Configure Vitest to report all failures (not fail-fast within tests) for complete diagnostics.
  8. Test: add a failing test, verify gate report contains the failure details.
  9. Test: add a `.skip` marker, verify the gate detects it and fails.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/vitest.config.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (test script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml` (gate step)
- Acceptance:
  - All unit tests execute; none skipped.
  - `.skip`, `.only`, `.todo` markers are detected and fail the gate.
  - Structured report with complete test results.
  - Deterministic execution.
- Parallel: No.

### Subtask T005 - Implement Gate 4: Playwright e2e tests

- Purpose: Run end-to-end tests against a built desktop artifact to validate user-facing flows.
- Steps:
  1. Ensure `playwright.config.ts` is configured for headless testing against the ElectroBun desktop artifact.
  2. Add a CI workflow step that first runs `bun run build` to produce the desktop artifact, then runs Playwright tests against it.
  3. Configure the CI runner for headless display: install Xvfb or use Playwright's built-in headless mode.
  4. Parse Playwright output to generate structured JSON gate report with: test name, file path, status, duration, and failure screenshots/traces if applicable.
  5. Add `test:e2e` script to root `package.json`.
  6. Configure Playwright to report all failures (not fail-fast) for complete diagnostics.
  7. Add retry count of 0 (no retries; flaky tests are failures per constitution).
  8. Test: create a minimal e2e test that verifies the desktop shell opens; verify it passes in CI.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/playwright.config.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (test:e2e script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml` (gate step)
- Acceptance:
  - Playwright tests run in headless mode on CI.
  - Gate produces structured report with test results.
  - No retries; flaky tests fail.
- Parallel: Yes (after T001 pipeline skeleton is in place).

### Subtask T006 - Create structured gate report generator

- Purpose: Provide a shared utility for all gates to produce consistent, machine-readable JSON reports.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/gate-report.ts`.
  2. Define TypeScript interfaces for gate reports: `GateReport` with `gateName`, `status` ("pass" | "fail"), `findings` array, `duration` (ms), `timestamp` (ISO 8601).
  3. Define `GateFinding` with `file`, `line`, `column` (optional), `message`, `severity` ("error" | "warning" | "info"), `rule` (optional), `remediation` (optional hint).
  4. Implement `createGateReport(gateName, findings, durationMs)` function that constructs the report object.
  5. Implement `writeGateReport(report, outputPath)` that writes the JSON to disk.
  6. Implement `aggregateGateReports(reports[])` that combines multiple gate reports into a pipeline summary.
  7. Export all interfaces and functions for use by individual gate scripts.
  8. Add unit tests for the report generator in `scripts/tests/gate-report.test.ts`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/gate-report.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/gate-report.test.ts`
- Acceptance:
  - All gate reports conform to a single schema.
  - Aggregation produces a valid pipeline summary.
  - Unit tests cover normal and edge cases.
- Parallel: Yes (after T001 pipeline skeleton is in place).

## Test Strategy

- Each gate tested with known-good and known-bad fixtures.
- Structured JSON report validated against schema for every gate.
- CI workflow tested via push to a test branch.
- Gate report generator unit tested.

## Risks & Mitigations

- Risk: Playwright requires display server on CI.
- Mitigation: Use Playwright's built-in headless mode; add Xvfb fallback.
- Risk: Biome does not cover all constitution-required rules.
- Mitigation: Add ESLint as targeted secondary check for gaps.

## Review Guidance

- Confirm all 4 gates produce structured JSON reports.
- Confirm pipeline fails on first gate failure.
- Confirm Biome is at max strictness with no ignores.
- Confirm Vitest catches `.skip`/`.only`/`.todo` markers.
- Confirm CI artifacts are uploaded for each gate.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:33:25Z – claude-haiku – shell_pid=70715 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:35:13Z – claude-haiku – shell_pid=70715 – lane=done – Implemented
