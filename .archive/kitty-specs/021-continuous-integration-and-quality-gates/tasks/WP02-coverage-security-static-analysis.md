---
work_package_id: WP02
title: Coverage, Security, and Static Analysis Gates
lane: "done"
dependencies:
- WP01
base_branch: 021-continuous-integration-and-quality-gates-WP01
base_commit: 5216a91bd2b6d05aa4d8a9df19edd5b2e3d8831e
created_at: '2026-03-01T13:35:19.314038+00:00'
subtasks:
- T007
- T008
- T009
- T010
- T011
phase: Phase 1 - CI Foundation
assignee: ''
agent: "claude-haiku"
shell_pid: "79606"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Coverage, Security, and Static Analysis Gates

## Objectives & Success Criteria

- Implement Gates 5, 6, and 7: coverage threshold enforcement, security vulnerability scanning, and static analysis.
- Generate structured JSON reports for each gate.
- Enforce 85% coverage per-package and aggregate.

Success criteria:
- Coverage below 85% in any package fails the gate with current percentage and threshold.
- Known vulnerabilities in dependencies fail the security gate with severity and remediation.
- Anti-patterns and complexity violations fail the static analysis gate.
- All gate reports are structured JSON.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/021-continuous-integration-and-quality-gates/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/021-continuous-integration-and-quality-gates/spec.md`
- WP01 output: CI pipeline, gate report infrastructure, typecheck/lint/test gates.

Constraints:
- Coverage enforced per-package AND aggregate at >= 85%.
- Security scan must flag high/critical vulnerabilities as failures.
- Static analysis must detect dead code and complexity violations.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T007 - Implement Gate 5: Coverage threshold enforcement

- Purpose: Ensure every workspace package and the aggregate monorepo maintain at least 85% line coverage.
- Steps:
  1. Configure Vitest coverage provider (c8 or istanbul) in `vitest.config.ts` with `coverage.enabled: true`.
  2. Set coverage thresholds in Vitest config: `lines: 85`, `functions: 85`, `branches: 85`, `statements: 85`.
  3. Configure per-workspace coverage collection so each package is measured independently.
  4. Add the CI workflow gate step that runs Vitest with coverage enabled and checks thresholds.
  5. Parse coverage output (JSON summary) to generate a structured gate report listing each package's coverage percentages against thresholds.
  6. If any package is below threshold, the report must include: package name, metric (lines/functions/branches/statements), current percentage, threshold.
  7. Generate an aggregate coverage summary across all packages.
  8. Add `test:coverage` script to root `package.json`.
  9. Test: remove tests from a package to drop coverage below 85%, verify the gate fails with specific package and percentage.
  10. Test: verify a zero-coverage package (new package with no tests) fails the gate.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/vitest.config.ts` (coverage config)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (test:coverage script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml` (gate step)
- Acceptance:
  - Per-package and aggregate coverage enforced at 85%.
  - Gate fails with specific package, metric, and percentage on violations.
  - Zero-coverage packages are detected.
- Parallel: No.

### Subtask T008 - Implement Gate 6: Security vulnerability scan

- Purpose: Detect known security vulnerabilities in dependencies and fail the pipeline on high/critical findings.
- Steps:
  1. Evaluate available security scanning tools compatible with Bun: `bun audit` (if available), `npm audit` as fallback, or a dedicated tool like Snyk CLI.
  2. Configure the chosen tool to scan all workspace dependencies including transitive dependencies.
  3. Add the CI workflow gate step that runs the security scan.
  4. Parse scan output to generate a structured gate report with: vulnerability ID, package name, affected version, severity (low/medium/high/critical), description, and remediation (upgrade path or patch).
  5. Configure the gate to fail on high or critical severity findings only; medium/low are reported but do not fail.
  6. Handle prerelease dependencies gracefully: known prerelease advisories from spec 020's manifest should be cross-referenced.
  7. Add `security:scan` script to root `package.json`.
  8. Test: add a known-vulnerable dependency version (in a test fixture), verify the gate detects it.
  9. Handle edge case: scanner not available or network unreachable (fail the gate with a clear message, do not silently pass).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (security:scan script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml` (gate step)
- Acceptance:
  - High/critical vulnerabilities fail the gate.
  - Reports include vulnerability details and remediation.
  - Scanner unavailability fails the gate (not silent pass).
- Parallel: No.

### Subtask T009 - Implement Gate 7: Static analysis

- Purpose: Detect anti-patterns, excessive complexity, and dead code that reduce maintainability.
- Steps:
  1. Select a static analysis tool compatible with TypeScript and Bun: consider `ts-morph` for custom analysis, or `knip` for dead code detection, or a combination.
  2. Configure complexity thresholds: maximum cyclomatic complexity per function (e.g., 15), maximum function length (e.g., 50 lines), maximum file length (500 lines per constitution).
  3. Configure dead code detection: unused exports, unreachable code, unused imports.
  4. Add the CI workflow gate step that runs the static analysis.
  5. Parse output to generate a structured gate report with: finding type (complexity/dead-code/anti-pattern), file, line, current value, threshold, and description.
  6. Fail the gate on any threshold violation.
  7. Add `analyze` script to root `package.json`.
  8. Test: introduce a function with excessive cyclomatic complexity, verify the gate detects it.
  9. Test: add an unused export, verify dead code detection catches it.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (analyze script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml` (gate step)
- Acceptance:
  - Complexity violations detected and reported.
  - Dead code detected and reported.
  - File length > 500 lines detected.
  - Structured gate report produced.
- Parallel: No.

### Subtask T010 - Coverage manifest generation

- Purpose: Produce a per-package and aggregate coverage manifest for downstream consumption (dashboards, PR comments).
- Steps:
  1. After the coverage gate runs, generate a `coverage-manifest.json` artifact.
  2. Include per-package entries: package name, lines/functions/branches/statements percentages, threshold, pass/fail status.
  3. Include aggregate entry with the same metrics across all packages.
  4. Include metadata: commit SHA, timestamp, total test count, total test duration.
  5. Upload the manifest as a CI artifact alongside gate reports.
  6. Add a script `scripts/coverage-manifest.ts` that reads Vitest coverage output and produces the manifest.
  7. Test: verify the manifest correctly reflects coverage data from known fixtures.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/coverage-manifest.ts`
- Acceptance:
  - Manifest accurately reflects per-package and aggregate coverage.
  - Manifest is valid JSON with all required fields.
- Parallel: Yes (after T007 coverage gate is functional).

### Subtask T011 - Gate integration tests

- Purpose: Verify each gate produces correct pass/fail results for known inputs, catching gate regressions.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/gates-integration.test.ts`.
  2. Test coverage gate: provide fixture with below-threshold coverage data, verify gate report shows failure with correct metrics.
  3. Test coverage gate: provide fixture with above-threshold data, verify gate report shows pass.
  4. Test security gate: mock scanner output with known vulnerability, verify gate report contains vulnerability details.
  5. Test security gate: mock clean scanner output, verify pass.
  6. Test static analysis gate: provide fixture with excessive complexity, verify gate report detects violation.
  7. Test static analysis gate: provide clean fixture, verify pass.
  8. Verify all gate reports conform to the shared `GateReport` schema from WP01.
  9. Ensure tests are deterministic with mocked external tools.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/gates-integration.test.ts`
- Acceptance:
  - All gate pass/fail scenarios covered.
  - Reports validated against schema.
  - Tests are deterministic.
- Parallel: Yes (after T007-T009 are stable).

## Test Strategy

- Fixture-based tests with known-good and known-bad data for each gate.
- Schema validation for all gate reports.
- Mocked external tools for deterministic results.
- Manual validation on CI by pushing known-bad commits.

## Risks & Mitigations

- Risk: Security scanner false positives on prerelease deps.
- Mitigation: Cross-reference with spec 020 manifest; document exceptions without auto-suppressing.
- Risk: Static analysis tool has high false positive rate.
- Mitigation: Start with conservative thresholds; tune based on initial baseline.

## Review Guidance

- Confirm 85% threshold is enforced per-package and aggregate.
- Confirm security gate does not silently pass on scanner failure.
- Confirm static analysis thresholds match constitution requirements.
- Confirm all reports are structured JSON with required fields.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:35:19Z – claude-haiku – shell_pid=79606 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:37:06Z – claude-haiku – shell_pid=79606 – lane=done – Implemented
