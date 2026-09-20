# CVP Evidence Gate (Slice 4 of 5)

**Status:** Landed on `wbs/cvp`, pending PR #203 to `main`.
**Scope:** Land CVP evidence on main + add a CI gate that validates the committed JSON.

---

## What this slice delivers

Slice 4 puts the Customer Validation Pack (CVP) onto `main` and adds a
CI gate that prevents regressions in the documented 1000-concurrent-
session claim.

Two pieces:

1. **CVP evidence** (one file cherry-picked from
   `origin/wbs/terminal-slice`):

   - `docs/cvp/cvp-1000.json` — the committed 1000-lane evidence.

   The CVP harness (`apps/runtime/tests/cvp/cvp-harness.ts`) and its
   regression suite were considered for cherry-pick too, but both
   depend on terminal-first work (`VerticalSliceDriver`,
   `RecordingRendererAdapter`) that hasn't landed on `main` yet. The
   harness stays opt-in (`CVP_SCALING=1 CVP_TARGET=1000`) on the
   terminal-slice branch and will be cherry-picked alongside its
   dependencies in a follow-up. The 1000-lane JSON is evidence only;
   it doesn't import anything.

2. **CI gate** (new files):

   - `scripts/cvp-evidence-validate.ts` (354 lines) — four checks
     against the committed JSON.
   - `scripts/tests/cvp-evidence-validate.test.ts` (288 lines, 22
     tests) — every check covered.
   - `.github/workflows/cvp-evidence.yml` (82 lines) — runs on every
     pull request targeting `main` and on `workflow_dispatch`.
   - `.github/required-checks.txt` — adds `cvp-evidence.yml|CVP Evidence`.

## Validator script and tests

`scripts/cvp-evidence-validate.ts` exports:

- `readCvpReport(path)` — parses the JSON; returns `null` on missing
  / invalid input.
- `checkSchema(report)` — `schema === "helios.cvp.v1"` (skip when no
  evidence is committed yet).
- `checkOverallPass(report)` — `overallPass === true`.
- `checkPerCheckFlags(report)` — every entry in `pass.*` is true.
- `checkThresholdBounds(report)` — every measurement is within the
  thresholds the harness itself computed (`thresholds.*`).
- `evaluateCvpReport(report)` — runs all four checks; returns findings.
- Constants: `EXPECTED_SCHEMA`, `EXPECTED_COUNT`, `PASS_KEYS`,
  `DEFAULT_EVIDENCE_PATH`, `REPORT_PATH`.
- CLI: `--file PATH`, `--commit SHA`.

The CLI writes `.gate-reports/cvp-evidence.json` (machine-readable)
and a human summary on stdout. Exits 0 iff every check is `pass` or
`skip`.

`scripts/tests/cvp-evidence-validate.test.ts` covers:

- `readCvpReport` (3 tests): valid, missing, invalid-JSON.
- `checkSchema` (3 tests): pass, wrong schema, null.
- `checkOverallPass` (2 tests): pass, fail.
- `checkPerCheckFlags` (3 tests): pass, single-flag fail, all-flags fail.
- `checkThresholdBounds` (6 tests): pass; per-check fails for
  lanesBound / spawn p99 / cleanup / memory / total.
- `evaluateCvpReport` (3 tests): all-pass, fail-finding, all-skip on null.
- `module exports` (1 test): constant stability.

## How to verify locally

```sh
# Run the validator against the committed evidence
bun run scripts/cvp-evidence-validate.ts

# Run the unit tests
bun test scripts/tests/cvp-evidence-validate.test.ts

# Biome check
bunx --package=@biomejs/biome@2.5.11 biome check scripts/cvp-evidence-validate.ts scripts/tests/cvp-evidence-validate.test.ts

# Static analysis gate
bun run scripts/gate-static-analysis.ts
```

All four should exit 0.

## Workflow design notes

- **No `workflow_run` here.** Unlike the release-evidence gate (slice 3),
  this one does not need to follow another workflow. The committed JSON
  is small enough to inspect on every PR.
- **No harness execution in CI.** Running 1000 concurrent PTYs on a
  GitHub-hosted runner is expensive and load-sensitive; the harness
  stays opt-in via `CVP_SCALING=1` for local / scheduled execution.
- **Job status drives the check.** GitHub maps `job.conclusion` to the
  PR's check status automatically; no `gh api` calls needed.
- **Manual dispatch supported.** Operators can re-validate any commit
  without opening a PR.
- **Skip-on-missing.** Until the harness lands on main, the JSON may
  not be present in every PR; the gate skips rather than fails when
  no evidence is committed yet.

## What is enforced today

A `pull_request` against `main` is blocked at the branch-protection
layer unless `cvp-evidence.yml|CVP Evidence` succeeds. With
`docs/cvp/cvp-1000.json` committed, the gate fails if any of:

- The schema is not `helios.cvp.v1`.
- `overallPass` is `false`.
- Any of `pass.lanesBound`, `pass.totalDuration`, `pass.spawnLatency`,
  `pass.cleanupLatency`, `pass.memoryStability` is `false`.
- Any measurement exceeds its `thresholds.*` bound (defence in depth).

When the JSON file is missing, the gate skips all four checks and
exits 0.

## What is not yet enforced

- **Freshness of the committed JSON.** A passing 1000-lane run from
  2026 is still treated as evidence in 2027. A future slice should
  either (a) gate on `generatedAt` being within N days of HEAD, or
  (b) refresh the JSON as part of the release flow.
- **Per-release JSON files.** Today only `cvp-1000.json` is gated.
  Once the harness is wired into the release pipeline, each release
  should publish its own `cvp-<version>.json` and the gate should
  validate the most recent one.
- **CVP harness and regression suite.** The 25/100/250-lane scaling
  regression suite (`apps/runtime/tests/cvp/cvp-scaling.test.ts`) and
  the 1000-lane harness (`apps/runtime/tests/cvp/cvp-harness.ts`)
  stay on `origin/wbs/terminal-slice` until terminal-first lands on
  main. Both import `VerticalSliceDriver` and
  `RecordingRendererAdapter`, which are terminal-first deliverables.

## Follow-ups (not in this slice)

- Refresh `docs/cvp/cvp-1000.json` on every release commit, scoped to
  the same SHA via a `workflow_run` follower pattern.
- Add a freshness check (`generatedAt` within 30 days of `HEAD`).
- Land `VerticalSliceDriver` + `RecordingRendererAdapter` (slice 1
  / slice 2 follow-ups) so the harness and scaling regression suite
  can come over too.
- Wire `bun run cvp:scaling` into a weekly scheduled job so the
  regression suite catches drift before it affects the 1000-lane
  claim.
