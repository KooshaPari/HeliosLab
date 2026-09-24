# CVP Freshness Gate (Slice 6 / F3)

**Status:** Implemented on branch `wbs/cvp-freshness`; pending merge.
**See also:** [`docs/plans/WBS.md`](../WBS.md), [`docs/plans/tasks/cvp-evidence.md`](cvp-evidence.md).
**Branch:** `wbs/cvp-freshness`
**Scope:** Add a freshness check to the CVP evidence validator so a passing 1000-lane run from 2026 cannot silently count as evidence in 2027.

---

## What F3 delivers

A new `checkFreshness` function in `scripts/cvp-evidence-validate.ts`
+ a `--max-age-days <N>` CLI flag (default 90, `0` disables) + an
operational override via the `CVP_MAX_AGE_DAYS` GitHub Actions
variable. No new required check is added; the existing `CVP
Evidence` job already fails on any non-pass, non-skip finding.

### Files changed

- `scripts/cvp-evidence-validate.ts`
  - Add `DEFAULT_MAX_AGE_DAYS = 90` and `MS_PER_DAY` exports.
  - Add `FreshnessOptions` interface (`maxAgeDays`, optional `now`).
  - Add `checkFreshness(report, opts)` returning `skip` / `pass` /
    `fail` with a human-readable detail string.
  - Extend `evaluateCvpReport` to take `FreshnessOptions` (default
    `{ maxAgeDays: DEFAULT_MAX_AGE_DAYS }`) and include `freshness`
    as the fifth finding.
  - CLI: parse `--max-age-days <N>`, `--now <ISO>`. Invalid
    `maxAgeDays` exits 2 (caller error); valid `0` disables the
    check.
- `scripts/tests/cvp-evidence-validate.test.ts`
  - Pin `now` on every `evaluateCvpReport` / `checkFreshness` call
    so the suite is deterministic.
  - Add 6 new tests in `describe("checkFreshness")`.
  - Update `evaluateCvpReport` tests to expect 5 findings.
  - Update `module exports` test to assert `DEFAULT_MAX_AGE_DAYS`
    and `MS_PER_DAY` constants.
- `.github/workflows/cvp-evidence.yml`
  - Resolve `vars.CVP_MAX_AGE_DAYS` (default `90`) and pass it to
    the validator. Allow operators to disable (`0`) or tighten the
    window without a code change.
- `docs/plans/tasks/cvp-evidence.md`
  - Refresh "what this slice delivers" + "what is enforced today"
    to call out the freshness check.
  - Drop the "freshness is not yet enforced" item from the
    follow-ups list.
- `docs/plans/WBS.md`
  - Add a row for slice 6 in the slice map.
  - Replace the numbered list of residual gaps with an F-ladder
    status table (F1-F7), marking F3 as "shipped in this branch —
    pending merge."

### Files NOT changed

- `docs/cvp/cvp-1000.json` — kept untouched. The committed
  evidence remains the authoritative 1000-lane run; F3 makes its
  `generatedAt` field actually load-bearing rather than decorative.
- `.github/required-checks.txt` — no new required-check name. The
  existing `CVP Evidence` job already covers the added finding.
- `docs/cvp/README.md` — still accurate; freshness is an
  internal-to-CI concern, not a reader-facing change.

## Validator semantics

```
$ bun scripts/cvp-evidence-validate.ts --max-age-days 90 --file docs/cvp/cvp-1000.json
  ✓ schema: Schema is helios.cvp.v1.
  ✓ overall-pass: overallPass is true.
  ✓ per-check-flags: All 5 pass flags are true (lanesBound, totalDuration, spawnLatency, cleanupLatency, memoryStability).
  ✓ threshold-bounds: All bounds satisfied: lanesBound === lanesRequested; totalMs < maxTotalMs; spawn p99_ms < maxSpawnP99Ms; cleanupMs < maxCleanupMs; memory delta MB < maxMemoryDeltaMb.
  ✓ freshness: Evidence is 4.55 days old (generatedAt=2026-09-19T19:33:01.937Z); within the 90-day limit.

CVP evidence gate passed for local (count=1000).
```

Tightening to `--max-age-days 4` makes the freshness check fail
because the committed evidence is 4.55 days old:

```
$ bun scripts/cvp-evidence-validate.ts --max-age-days 4 --file docs/cvp/cvp-1000.json
  ...
  ✗ freshness: Evidence is 4.55 days old (generatedAt=2026-09-19T19:33:01.937Z); limit is 4.

CVP evidence gate FAILED for local (count=1000).
# exit code 1
```

`--max-age-days 0` cleanly disables the check:

```
$ bun scripts/cvp-evidence-validate.ts --max-age-days 0 --file docs/cvp/cvp-1000.json
  ...
  · freshness: Freshness gate disabled (--max-age-days 0).

CVP evidence gate passed for local (count=1000).
```

## Review-hardening (post-CodeRabbit)

After the initial implementation, CodeRabbit flagged four subtle
defect paths. All are addressed in the validator:

1. **`generatedAt` must carry an explicit timezone.** The regex
   `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{2})?(Z|[+-]\d{2}:\d{2})$`
   accepts `Z` and `±HH:MM` offsets; naive timestamps like
   `2026-09-20T00:00:00` fail with `"generatedAt is not an ISO-8601
   timestamp with an explicit timezone"`. This avoids
   runtime-dependent interpretation (UTC vs local) so the CI,
   dev-laptop, and prod results all agree.
2. **Future-dated evidence is rejected.** A `generatedAt` later than
   `now` no longer silently passes because `-0.5 > 90` is false.
   `checkFreshness` now reports `fail` with `"… is N days in the
   future of now; evidence cannot be dated after the present"`. This
   catches clock-skewed CI runners and hand-edited JSON.
3. **`--max-age-days` operand must be a non-negative integer.**
   `Number.parseInt("3.14", 10)` silently returns `3`, which would
   turn `--max-age-days 3.14` into a 3-day limit instead of a
   caller error. We now validate the operand with
   `/^(0|[1-9]\d*)$/` before parsing. Garbage like `"abc"`,
   `"-5"`, `"3.14"`, or even `"3 "` now exits 2 with a clear
   message.
4. **`--now` requires an explicit timezone and parses to a finite
   timestamp.** Naive locals or garbage like `"not-a-date"` exit 2
   rather than producing surprising results. `--now` left off still
   defaults to `Date.now()`.

Test coverage: 11 freshness tests now exist (was 6) and 31 tests
total in the file (was 27). New tests: `fails on naive generatedAt`,
`fails when generatedAt is in the future of now`, `passes for offset
timestamps (not just Z)`, and `defaults freshness to
DEFAULT_MAX_AGE_DAYS and fails on a stale report`.

## Why default 90 days

The 1000-lane harness is expensive to run (load-sensitive,
materialises 1000 live PTYs). 90 days gives roughly one quarter of
margin to absorb infra outages, scheduling slips, and reviewer
unavailability without forcing a re-run. Operators with a tighter
cadence can drop to 30 via the `CVP_MAX_AGE_DAYS` repo variable
without re-rolling the validator.

## How to verify locally

```sh
# Unit tests (27 total, 6 new)
bun test scripts/tests/cvp-evidence-validate.test.ts

# Validator against the committed JSON, default 90-day window
bun run scripts/cvp-evidence-validate.ts

# Validator with a tighter window (should fail right now — evidence is 4.55 days old)
bun run scripts/cvp-evidence-validate.ts --max-age-days 4

# Validator with freshness disabled
bun run scripts/cvp-evidence-validate.ts --max-age-days 0

# Biome check (exact-version pin)
bunx --package=@biomejs/biome@2.5.11 biome check \
  scripts/cvp-evidence-validate.ts \
  scripts/tests/cvp-evidence-validate.test.ts

# Static analysis gate (slices 3+4 shared)
bun run scripts/gate-static-analysis.ts
```

All six should exit 0 except the second-to-last (Biome) which is
expected to be clean, and the `--max-age-days 4` run which
intentionally exits 1 to prove the gate works.

## What F3 does NOT do

- Does not generate a fresh `cvp-1000.json` in this branch. The
  committed evidence is the 2026-09-19 run that already satisfies
  slice 4; refreshing it is its own operational task.
- Does not add a per-release `cvp-<version>.json` artefact — that
  is F4 and depends on F1 (terminal-first landing) so the harness
  can be wired into `release.yml`.
- Does not change any required-check name; freshness rides on the
  existing `CVP Evidence` job's pass/fail.
- Does not gate on `cvp-1000.json` being present. The validator
  still skip-on-missing; making the JSON required is a separate
  discussion that should land after F1.

## Follow-ups after F3

- F4 — per-release `cvp-<version>.json` + gate (blocked on F1).
- F5 — public `recovery.crash.detected` bus topic + contract test
  (**merged**, [#207](https://github.com/KooshaPari/HeliosLab/pull/207) `5dcfd385`).
- F6 — true fork/exec cross-process restart test.
- F7 — SBOM generation inside `release.yml`.
- F1/F2 — terminal-first cherry-pick planning slice.
