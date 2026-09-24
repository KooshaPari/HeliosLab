# WBS — Work Breakdown Structure, HeliosLab

**Scope:** Reliability, evidence, and gate work needed to take
`main` from "feature-complete enough to demo" to "feature-complete
enough to ship a canary." Five slices, each a single squash-merge PR
into `main`.

**Owner:** Koosha Pari (@KooshaPari)
**Branch convention:** `wbs/<slice-topic>`
**Merge path:** `gh pr merge N --admin --squash --delete-branch`

---

## Slice map

| # | Topic | Branch | PR | Commit on `main` | Status |
|---|-------|--------|-----|------------------|--------|
| 1 | Protocol SSOT | (direct merge, no PR title retained) | — | pre-2026-09-20 | merged (frozen since before WBS kickoff) |
| 2 | Runtime durability core | `wbs/durability-impl` | [#201](https://github.com/KooshaPari/HeliosLab/pull/201) | `186f51df` | **merged** |
| 3 | Release evidence gate | `wbs/release-evidence` | [#202](https://github.com/KooshaPari/HeliosLab/pull/202) | `27876400` | **merged** |
| 4 | CVP evidence gate | `wbs/cvp` | [#203](https://github.com/KooshaPari/HeliosLab/pull/203) | `b66707a4` | **merged** |
| 5 | WBS closeout + follow-up ladder | `wbs/closeout` | [#204](https://github.com/KooshaPari/HeliosLab/pull/204) | `83dc9b4f` | **merged** |
| 6 | WBS follow-ups (F3 / F5 / F6 / F7) | `wbs/cvp-freshness`, `wbs/recovery-crash-topic`, … | [#205](https://github.com/KooshaPari/HeliosLab/pull/205) (F3), [#206](https://github.com/KooshaPari/HeliosLab/pull/206) (F3 doc), [#207](https://github.com/KooshaPari/HeliosLab/pull/207) (F5) | `e5e631f5` (F3), `5dcfd385` (F5) | F3 + F5 **merged**; F6 / F7 pending |

---

## What each slice delivers

### Slice 1 — Protocol SSOT (pre-WBS, frozen)

`docs/SSOT.md` plus a typed `protocol.ts` baseline that the runtime
contracts hang off. The slice existed before the WBS formally started;
what the WBS tracks is its consolidation into the runtime that slices
2-4 plug into.

### Slice 2 — Runtime durability core ([#201](https://github.com/KooshaPari/HeliosLab/pull/201))

Replaces the previous empty `AuditDurableStore` and `CheckpointStore`
with file-backed implementations; wires `DurabilityLayer` into
`createRuntime`; adds `detectOrphans` and `enforceRetention` on
`OrphanReconciler`; cross-process restart preserves on-disk
checkpoint. Slice 2 was merged alongside the slice-3 7-subsystem
`DurabilityLayer` rewrite (commit `73ff9cfc`) since the slice-3
`checksum: ""` empty-placeholder regression would have invalidated the
slice-2 SHA-256 fix.

**Gate it satisfies:** `Runtime Contract Tests` + `Coverage`
(85% lines threshold at 85.17%).

### Slice 3 — Release evidence gate ([#202](https://github.com/KooshaPari/HeliosLab/pull/202))

Adds `release-evidence.yml` as a `workflow_run` follower of `Release`
+ `Release Attestation`. Validates `VERSION` / `package.json` /
`Cargo.toml` agree, presence of SBOM, build manifest, and SLSA
provenance. The validator (`scripts/release-evidence-validate.ts`)
runs four checks (version-mismatch, missing-SBOM, missing-manifest,
missing-provenance) and ships with 27 tests. The previous
`docs/slsa.md` claim was hand-written and inaccurate; that file is
now driven by the gate's output rather than the other way around.
Also fixed the `VERSION` file drift (`canary.1` → `canary.3`) that
the hand-written `release-evidence-v0.14.11-canary.3.md` papered
over.

**Required-check added:** `release-evidence.yml|Release Evidence`
in `.github/required-checks.txt`.

### Slice 4 — CVP evidence gate ([#203](https://github.com/KooshaPari/HeliosLab/pull/203))

Lands the 1000-concurrent-session Customer Validation Pack evidence
(`docs/cvp/cvp-1000.json`) onto `main` and validates it on every PR.
Validator runs five checks (schema `helios.cvp.v1`, `overallPass`,
every `pass.*` flag, every measurement within its `thresholds.*`
bound, `generatedAt` freshness within `--max-age-days`). 31 unit
tests. The CVP harness, scaling regression suite, and scaling
orchestrator stay on `wbs/terminal-slice` for now because they
import `VerticalSliceDriver` and `RecordingRendererAdapter`, which
are terminal-first deliverables not yet on `main`. Freshness was
added by F3 (slice 6); see the F-ladder status table below.

**Required-check added:** `cvp-evidence.yml|CVP Evidence`
in `.github/required-checks.txt`.

**Skip-on-missing semantics:** When `docs/cvp/cvp-1000.json` is
absent, the gate skips rather than fails. This lets slice 4 land
without coupling it to the terminal-first branch. Once the harness
+ regression suite are cherry-picked (slice 5 follow-ups), the JSON
file is required for every PR.

### Slice 5 — WBS closeout + follow-up ladder

`docs/plans/WBS.md` (this file), refresh of the slice-3 and slice-4
plan docs to reflect their merged status, and an explicit ladder of
follow-up work for post-WBS slices (terminal-first vertical slice,
recording renderer adapter, CVP harness cherry-pick, freshness gate
on `cvp-1000.json` `generatedAt`, per-release `cvp-<version>.json`
artefacts).

---

## What is enforced on `main` today

These five checks are the **declared** required set in
`.github/required-checks.txt`:

```text
ci.yml|ci / lint
ci.yml|ci / test
required-check-names-guard.yml|verify-required-check-names
release-evidence.yml|Release Evidence
cvp-evidence.yml|CVP Evidence
```

Plus the repo's external providers (SonarCloud, Snyk, Semgrep, Infisical, …)
that are evaluated in the PR quality gate before Mergify admits the
PR to the merge queue.

**They are not enforced by branch protection today.** As of `5dcfd385`
the repo has no classic required status checks (`404 Required status
checks not enabled`), no rulesets, and no branch rules. `ci / lint` and
`ci / test` are the only two that must actually pass before merge;
`Release Evidence` is `workflow_run`-triggered on `main` and therefore
post-merge by design. Treat the list as documentation of intent, not
as an enforced gate, and verify the two CI checks manually.

The `verify-required-check-names` job pulls
`.github/required-checks.txt` and asserts that every entry maps to
a real workflow job on `main`, so an entry like `release-evidence.yml|Release Evidence`
will fail this guard if either the workflow file is renamed/removed
or the job inside is. This prevents a required-check name from
becoming stale without anyone noticing.

---

## Why these five slices

The WBS order is "evidence before claims, mechanism before
enforcement, terminal-first deferred to terminal-slice." Each slice
increases the surface area of `main` that is actually checked at PR
time, and each unblocks a different downstream consumer:

- **Slice 2** unblocks crash-loop recovery for any agent or test
  process that wants durable runtime state.
- **Slice 3** unblocks external auditors who need SLSA evidence and
  SBOMs attached to each release commit without a human in the loop.
- **Slice 4** turns the `Q7=A` capacity claim (1000 concurrent live
  sessions) from a hand-asserted number into a CI-enforced invariant
  on a committed JSON artefact.
- **Slice 5** tightens the loop by writing down what each slice did
  and what the residual gaps are, so the next session does not have
  to reconstruct the WBS history from commit messages alone.

---

## What is NOT yet enforced

These are explicit follow-ups, not latent bugs. They become slice 6
work in F-order, starting with F3 because it is the smallest blast-
radius PR and unblocks a meaningful invariant.

### F-ladder status

| ID | Gap | Branch | PR | Commit on `main` | Status |
|----|-----|--------|-----|------------------|--------|
| F1 | Terminal-first cherry-pick (depends on F2 and a slice-1 follow-up planning slice) | — | — | — | deferred (its own planning slice) |
| F2 | Parallel `durability` work landed alongside the cherry-pick | — | — | — | deferred (its own planning slice) |
| F3 | CVP JSON `generatedAt` freshness gate | `wbs/cvp-freshness` | [#205](https://github.com/KooshaPari/HeliosLab/pull/205) | `e5e631f5` | **merged** |
| F4 | Per-release `cvp-<version>.json` artefacts + gate | — | — | — | blocked on F1 (harness needs the harness in release flow) |
| F5 | Public `recovery.crash.detected` bus topic + contract test | `wbs/recovery-crash-topic` | [#207](https://github.com/KooshaPari/HeliosLab/pull/207) | `5dcfd385` | **merged** |
| F6 | True fork/exec cross-process restart test (`Bun.spawn` subprocess) | `wbs/f6-fork-exec` | [#209](https://github.com/KooshaPari/HeliosLab/pull/209) | (pending merge) | **shipped in this branch — pending merge** |
| F7 | SBOM generation inside `release.yml` | — | — | — | pending (slice-3 follow-up) |

### F3 — CVP freshness gate ([#205](https://github.com/KooshaPari/HeliosLab/pull/205), merged `e5e631f5`)

The committed `docs/cvp/cvp-1000.json` carries a `generatedAt`
timestamp. Today nothing gates on it — a passing run from 2026
silently counts as evidence in 2027. F3 adds `checkFreshness` to the
existing `cvp-evidence-validate.ts`:

- `generatedAt` must be within `maxAgeDays` of "now" (default 90 days).
- `--max-age-days 0` disables the check (returns `skip`).
- Operationally overridden per-repo via the `CVP_MAX_AGE_DAYS` GitHub
  Actions variable.
- **Strictness (post-CodeRabbit hardening):** `generatedAt` must carry
  an explicit timezone (`Z` or `±HH:MM`); future-dated evidence is
  rejected as "N days in the future of now"; `--max-age-days` and
  `--now` reject decimal / negative / unparseable operands with exit 2.
- 31 unit tests (was 27 — six new for `checkFreshness` and four new
  for the strictness paths). Mutation-tested each CLI rejection path
  with explicit exit-code capture.
- `evaluateCvpReport` now returns 5 findings instead of 4. No new
  required check is added — the existing `CVP Evidence` job already
  fails on any non-pass, non-skip finding.

### F5 — `recovery.crash.detected` public topic ([#207](https://github.com/KooshaPari/HeliosLab/pull/207), merged `5dcfd385`)

The slice-2 wiring internally subscribes to the watchdog's crash
event and routes it through crash-loop detection → safe mode, but
does not yet publish a public topic external consumers can listen on.
**Merged as `5dcfd385`.** The problem was deeper than
missing plumbing: `InMemoryLocalBus.subscribe()` — the bus the runtime
actually hands to `DurabilityLayer` — was a stub that never invoked
handlers, so the topic reached the event log but no external consumer
could observe it. `CommandBusImpl` already had a real implementation.

- `subscribe()` is a real registry with a working unsubscribe handle and
  `"*"` all-topics support (`BusAuditSubscriber` already assumed `"*"`
  and silently got nothing).
- `publish()` dispatches to subscribers on **both** the lifecycle-start
  branch and the main branch. The start branch used to `return` early, so
  subscribers silently missed operation starts while still receiving the
  matching terminal events.
- Handlers are invoked but **never awaited**. `Watchdog.handleCrash()`
  awaits `publish()` before recording the crash with the durability layer,
  so a subscriber whose promise never settles would stall crash recovery.
- Each subscriber gets a `structuredClone` of the envelope carrying `id`
  and `ts`, so a consumer cannot mutate the retained audit trail.
- Contract tests: 9 in `emitter.test.ts` (bus dispatch) plus 9 in
  `recovery-bus-topic.test.ts` (end-to-end crash topic). 11 mutations of
  the dispatch logic were applied and all 11 were caught by a failing
  test.

See `docs/plans/tasks/recovery-crash-detected.md` for the full contract
table, the mutation matrix, and the review-thread resolutions.

### F6 — fork/exec cross-process restart test

The slice-2 cross-process restart coverage used two
`createRuntime({ dataDir })` lifetimes in the same process. That is
strong enough for a CI gate, but it shares the V8 isolate, the module
registry, and every cached import, so it cannot catch bugs that only
appear when the OS reaps a process and hands a cold process the same
`dataDir`. F6 adds that missing layer.

- `apps/runtime/src/__tests__/create-runtime-fork-exec.test.ts` (new) —
  drives the subprocesses with `Bun.spawnSync`, the pattern already used
  elsewhere in the repo for real subprocess tests.
- `apps/runtime/src/__tests__/helpers/fork-exec-helper.ts` (new) — the
  spawned entry point. Modes: `seed`, `recover`, `recover-corrupt`.
  Every mode prints exactly one JSON object on stdout so the parent never
  parses logs.
- The first lifetime calls `process.exit(0)` **without** `runtime.close()`,
  so nothing flushes a final checkpoint or cleans up. A stale `.tmp` is
  left behind on purpose to reproduce the debris a real crash leaves.
- Both recovery tests assert that every pid involved is distinct, so a
  future refactor back to in-process lifetimes fails loudly rather than
  silently losing the coverage this slice exists to provide. The two
  failure-path tests assert exit codes and error payloads instead.
- Backup fallback is covered directly: two seed processes create a
  `.backup`, then a third cold process reads a primary whose checksum is
  wrong and whose session list has been swapped for a decoy. Getting the
  real session back proves the primary was rejected on integrity grounds.

4 tests, 35 assertions. Mutation-tested against
`apps/runtime/src/recovery/checkpoint.ts`: **6 of 8 mutations caught**
(atomic-write removal, checksum removal, backup removal, backup-fallback
removal, `verifyChecksum` neutered, `read()` disabled). The 2 survivors
are honest gaps, not harness noise:

- Removing `cleanStaleTempFiles()` is unobservable because `fs.writeFile`
  truncates the same `.tmp` path and the rename removes it either way.
  The method is redundant on the happy path.
- Removing the `fsync` cannot be caught without a power-cut simulation,
  which is out of scope for a test suite.

Both are recorded rather than papered over with a test that would pass
for the wrong reason.

### F7 — SBOM inside `release.yml`

The slice-3 release-evidence gate verifies SBOM presence, but
`release.yml` does not yet generate it; today the SBOM comes from the
scheduled `sbom-refresh` job. Follow-up: move generation inline so
the SBOM and the release commit are born from the same workflow run.

### F1 / F2 / F4 — terminal-first landing

Follow-up slice(s) — own planning slice required because they touch
50+ commits on `origin/wbs/terminal-slice` and need to bring
`RecordingRendererAdapter` + `VerticalSliceDriver` across in a
single landing to avoid drift between the cherry-pick and the harness.

---

## Open infrastructure tickets observed during the WBS

These are not slice work but were noticed while running slices 1-4:

- **PR #199** `feat(runtime): terminal-first vertical slice + durability + CVP evidence`
  has its `Required Checks Bridge` failing because slice 3 and slice
  4 added required-checks (`Release Evidence`, `CVP Evidence`) that
  #199's branch does not carry. The fix is a rebase of #199 onto
  `main` (now at slice 6 / F3); see the slice-5 plan doc for the
  recommended path.
- **SonarCloud** flips `FAILURE` on a few PRs even when the
  underlying scan is green — observed on slices 2, 3, 4, and the F3
  re-review. The failure is a tab-vs-space formatting drift in
  SonarCloud's expectations, not a real bug. Has not blocked any
  merge because the PR's other green checks dominate; worth filing
  once SonarCloud is on the supported-vendors list.
- **Sonar token missing** in the runner environment used by the
  dedicated `sonar` job — fails with `Require Sonar token`. Same
  not-required status as the SonarCloud drift above.

---

## Appendix — local-verification snippets

```sh
# Slice 2 gate
bun test apps/runtime --coverage

# Slice 3 gate
bun run scripts/release-evidence-validate.ts --file docs/release-evidence/release-evidence.md
bun test scripts/tests/release-evidence-validate.test.ts

# Slice 4 gate
bun run scripts/cvp-evidence-validate.ts \
  --file docs/cvp/cvp-1000.json \
  --max-age-days 90
# Override via env-equivalent CLI: --max-age-days 0 disables freshness;
# --max-age-days 30 tightens it; --now 2027-01-01 pins deterministic tests.
bun test scripts/tests/cvp-evidence-validate.test.ts

# Static analysis (slices 3+4 shared)
bun run scripts/gate-static-analysis.ts

# Required-check hygiene. Run the real guard: it resolves each
# `workflow|job` entry against the workflow files, so a renamed or
# deleted workflow or job fails. A bare grep of the manifest would
# only prove the manifest is still readable.
gh workflow run required-check-names-guard.yml --ref main
# Locally, the same assertion can be reproduced with:
#   gh workflow view required-check-names-guard.yml --yaml main
# Note: branch protection enforces only `ci / lint` and `ci / test`
# today, and `Release Evidence` is post-merge by design.
```
