---
work_package_id: WP03
title: Bypass Detection, Local Gate Mirror, and Tests
lane: "doing"
dependencies:
- WP02
base_branch: 021-continuous-integration-and-quality-gates-WP02
base_commit: 24180c28790492ee483312ab481a9b593573a469
created_at: '2026-03-01T13:37:11.509286+00:00'
subtasks:
- T012
- T013
- T014
- T015
- T016
- T017
phase: Phase 2 - Enforcement
assignee: ''
agent: "claude-haiku"
shell_pid: "90407"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP03 - Bypass Detection, Local Gate Mirror, and Tests

## Objectives & Success Criteria

- Implement Gate 8 (bypass detection) that scans for all forms of suppression directives.
- Deliver `bun run gates` local command that mirrors the CI pipeline exactly.
- Validate pipeline idempotency and local/CI parity.

Success criteria:
- Every suppression directive type is detected and fails the bypass gate.
- `bun run gates` produces identical pass/fail as CI for the same commit.
- Running the pipeline twice on the same commit produces identical results.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/021-continuous-integration-and-quality-gates/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/021-continuous-integration-and-quality-gates/spec.md`
- WP01/WP02 output: CI pipeline with 7 gates, gate report infrastructure.

Constraints:
- No suppression directives permitted anywhere in source (constitution).
- Local and CI execution must be identical in behavior.
- Pipeline must be idempotent (NFR-003).
- Exclude `node_modules/` and generated files from bypass scanning.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP03`

## Subtasks & Detailed Guidance

### Subtask T012 - Implement Gate 8: Bypass detection

- Purpose: Detect and reject all forms of quality gate suppression directives in source code.
- Steps:
  1. Define the complete list of suppression patterns to detect:
     - TypeScript: `@ts-ignore`, `@ts-expect-error` (without a matching error), `@ts-nocheck`
     - ESLint: `eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line`
     - Biome: `biome-ignore`
     - Test markers: `.skip`, `.only`, `.todo` in test files (`.test.ts`, `.spec.ts`)
  2. Add the gate step in the CI workflow after all other gates.
  3. The gate invokes the standalone scanner from T013.
  4. On any finding, the gate fails with the structured report listing each suppression.
  5. Configure exclusions: `node_modules/`, `dist/`, and any explicitly configured generated-file paths in a `.bypass-exclude` config.
  6. Ensure the scanner handles edge cases: suppression patterns inside string literals or comments that are not actual directives (minimize false positives while still being strict).
  7. Test: add each suppression type, verify it is detected.
  8. Test: verify suppression-like text inside a string literal is handled appropriately.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/.github/workflows/quality-gates.yml` (gate step)
- Acceptance:
  - All suppression directive types detected.
  - Exclusion paths respected.
  - Structured gate report with file, line, directive type for each finding.
- Parallel: No.

### Subtask T013 - Create standalone bypass detection scanner

- Purpose: Provide a reusable script that scans source files for suppression directives, usable by both CI and `bun run gates`.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/gate-bypass-detect.ts`.
  2. Accept command-line arguments: `--root <dir>` (default: repo root), `--exclude <glob>` (repeatable), `--json` (output JSON report).
  3. Recursively scan all `.ts`, `.tsx`, `.js`, `.jsx` files under root, excluding configured paths.
  4. For each file, scan line by line for suppression patterns. Track: file path, line number, column, matched pattern, and the full line content for context.
  5. For test files (matching `*.test.ts`, `*.spec.ts`), additionally scan for `.skip(`, `.only(`, `.todo(` patterns.
  6. Output results as a table to stdout (default) or as structured JSON (`--json` flag).
  7. Exit 0 if no findings; exit 1 if any findings.
  8. Import and use the `GateReport` and `GateFinding` interfaces from `scripts/gate-report.ts` for JSON output.
  9. Handle large codebases efficiently: stream file reads, avoid loading entire files into memory.
  10. Add the scanner as a named export so it can be imported by `scripts/gates.ts`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/gate-bypass-detect.ts`
- Acceptance:
  - Scanner detects all defined suppression patterns.
  - Exclusion paths work correctly.
  - JSON output conforms to GateReport schema.
  - Efficient for large codebases.
- Parallel: No.

### Subtask T014 - Implement bun run gates local entrypoint

- Purpose: Provide a single local command that runs the identical 8-gate suite as CI, so developers catch failures before pushing.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/gates.ts`.
  2. Import or invoke each gate in the same order as CI: typecheck, lint, test, e2e, coverage, security, static analysis, bypass detection.
  3. Use the same configurations, thresholds, and tools as CI.
  4. Collect results from each gate into an aggregated report.
  5. Print a summary table: gate name, status (pass/fail), duration, finding count.
  6. On any gate failure, continue running remaining gates (report all failures, do not stop at first).
  7. After all gates: exit 0 if all pass, exit 1 if any fail.
  8. Support `--json` flag for structured JSON output of the aggregated report.
  9. Support `--gate <name>` flag to run a single specific gate (useful for debugging).
  10. Add `gates` script to root `package.json`.
  11. Ensure the local gates script shares configuration with CI (read from the same biome.json, vitest.config.ts, etc.).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/gates.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (gates script)
- Acceptance:
  - `bun run gates` runs all 8 gates in order.
  - Results match what CI would produce for the same code.
  - Summary table printed to console.
  - JSON output available.
- Parallel: No.

### Subtask T015 - Bypass detection tests

- Purpose: Verify the bypass detection scanner catches all suppression directive types and handles edge cases correctly.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/gate-bypass-detect.test.ts`.
  2. Create fixture files in a temp directory for each test case.
  3. Test: file with `@ts-ignore` is detected with correct file and line.
  4. Test: file with `@ts-expect-error` is detected.
  5. Test: file with `eslint-disable` (block, line, and next-line variants) is detected.
  6. Test: file with `biome-ignore` is detected.
  7. Test: test file with `.skip(` is detected.
  8. Test: test file with `.only(` is detected.
  9. Test: test file with `.todo(` is detected.
  10. Test: file with suppression-like text inside a string literal (e.g., `const msg = "@ts-ignore is bad"`) — verify it is handled appropriately (document whether flagged or not).
  11. Test: clean file produces zero findings.
  12. Test: excluded paths are not scanned.
  13. Test: JSON output conforms to GateReport schema.
  14. Clean up temp fixture files after tests.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/gate-bypass-detect.test.ts`
- Acceptance:
  - All suppression types covered.
  - Edge cases documented and tested.
  - Tests are deterministic.
- Parallel: Yes (after T012-T013 are functional).

### Subtask T016 - Local/CI parity tests

- Purpose: Verify that `bun run gates` produces identical results to the CI pipeline for the same codebase state.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/gates-parity.test.ts`.
  2. Test: run `bun run gates` on a clean codebase, verify all 8 gates pass.
  3. Test: introduce a type error, run `bun run gates`, verify the typecheck gate fails with the same diagnostics CI would produce.
  4. Test: introduce a lint violation, run `bun run gates`, verify the lint gate fails.
  5. Test: verify the gate execution order matches CI (typecheck -> lint -> test -> e2e -> coverage -> security -> static -> bypass).
  6. Test: verify `--gate typecheck` runs only the typecheck gate.
  7. Test: verify `--json` produces valid aggregated report.
  8. Compare gate configurations: verify `bun run gates` reads the same biome.json, vitest.config.ts, and thresholds as CI.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/gates-parity.test.ts`
- Acceptance:
  - Local and CI produce identical results.
  - Gate order verified.
  - Single-gate mode works.
- Parallel: Yes (after T014 is functional).

### Subtask T017 - Pipeline idempotency validation

- Purpose: Confirm that running the pipeline twice on the same commit produces identical results, per NFR-003.
- Steps:
  1. Run `bun run gates` on the current codebase, capture the JSON output.
  2. Run `bun run gates` again on the same codebase without any changes, capture the JSON output.
  3. Compare the two outputs: all gate statuses and finding counts must be identical.
  4. Durations may differ but status and findings must match exactly.
  5. Document the validation results.
  6. If any non-determinism is found, identify and fix the source.
- Files:
  - No new files; validation documented in PR description.
- Acceptance:
  - Two consecutive runs produce identical pass/fail and finding results.
  - Any non-determinism identified and resolved.
- Parallel: No.

## Test Strategy

- Fixture-based bypass detection tests with temp files.
- Parity tests comparing local and CI gate behavior.
- Idempotency tests via repeated execution.
- All tests deterministic and self-cleaning.

## Risks & Mitigations

- Risk: Suppression patterns in string literals cause false positives.
- Mitigation: Document the behavior; err on the side of strictness per constitution.
- Risk: Local environment differs from CI (different tool versions).
- Mitigation: Pin all tool versions in package.json; use Bun's lockfile for determinism.

## Review Guidance

- Confirm all suppression directive types are detected.
- Confirm `bun run gates` matches CI behavior exactly.
- Confirm idempotency holds for all gates.
- Confirm exclusion paths are limited and documented.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:37:11Z – claude-haiku – shell_pid=90407 – lane=doing – Assigned agent via workflow command
