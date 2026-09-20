# Release Evidence Plan

**Date:** 2026-09-20
**Branch:** wbs/release-evidence
**Goal:** Make every `release:` commit on `main` carry a complete evidence bundle
that downstream consumers can verify, without requiring an out-of-band doc.

---

## Why this slice exists

Before this slice, three release-evidence artefacts lived in this repo:

- `.github/workflows/release.yml` — publishes Rust crates to crates.io on a
  `release:` commit to `main`, with **no SLSA, no SBOM, no manifest**.
- `.github/workflows/release-attestation.yml` — generates SLSA Build L2
  provenance, but only fires on `release: published` (a GitHub Release
  event that `release.yml` never creates) or on manual dispatch.
- `docs/slsa.md` — claimed "SLSA Build L2 (achieved today)" based on
  the attestation workflow existing, not on it actually firing.

The two workflows were decoupled: the path that actually publishes
artifacts (`release.yml`) produced zero evidence, while the path that
generated evidence (`release-attestation.yml`) was effectively dead.
A `chore(release): v0.14.11-canary.3` commit could land, ship to
crates.io, and leave no trace of what was built or where.

The previous version of this file (`release-evidence-v0.14.11-canary.3.md`,
on `wbs/terminal-slice`) was hand-written and inaccurate — it claimed
the `VERSION` file had been updated to `canary.3` when in fact it was
still at `canary.1`. That is the exact failure mode this slice exists
to prevent: release evidence that drifts from reality because it is
produced by humans rather than enforced by CI.

## What this slice delivers

### 1. Evidence gate workflow

`.github/workflows/release-evidence.yml` runs on every push to `main`
whose commit message contains `release:` or `chore(release)`, plus
manual `workflow_dispatch`. The gate is **post-merge** by design:
release evidence (SBOM, BUILD_MANIFEST, SLSA provenance) is produced
by `release.yml` and `release-attestation.yml`, which themselves only
fire on push to `main`. Pre-merge validation cannot reach those
artifacts. The gate posts a single check named **Release Evidence**
that branch protection may require. The job:

1. Resolves the commit SHA.
2. Calls `actions:listWorkflowRuns` filtered to `release.yml` on that SHA.
   If the release workflow never ran (no `release:` commit), the gate
   marks the relevant checks as `skip` and exits 0; release-evidence
   must not block unrelated pushes.
3. Calls `actions:listWorkflowRunArtifacts` to enumerate release
   artefacts, writes their filenames to a temp file, and passes the
   file to the validator script.
4. Runs the validator (`bun run scripts/release-evidence-validate.ts
   --artifact-list release-artifacts.txt --commit <sha>`).
5. Uploads `.gate-reports/release-evidence.json` as a workflow artefact
   for human inspection.

GitHub Actions does not register brand-new workflows that exist only
on a PR branch; the workflow file must land on `main` before it fires
automatically. This is documented GitHub behavior; the workaround is
to merge the slice first, after which every subsequent release commit
runs the gate.

### 2. Validator script and tests

`scripts/release-evidence-validate.ts` is the unit-testable core. It
exports five pure functions (`readVersionFile`, `readPackageJsonVersion`,
`readCargoWorkspaceVersion`, `checkVersionConsistency`,
`checkArtifactPresence`) and a CLI entry point guarded by
`import.meta.main`.

The validator checks, in order:

| Check | Source | Required |
|-------|--------|----------|
| `version-consistency` | `VERSION`, `package.json`, `Cargo.toml` | yes |
| `sbom-present` | artefact filenames or downloaded dir | yes |
| `build-manifest-present` | artefact filenames or downloaded dir | yes |
| `slsa-provenance-attached` | artefact filenames (`.intoto.jsonl` or `BUILD_MANIFEST.txt`) | yes |

A `skip` status is allowed when the workflow run list is empty
(non-release commit). All checks must pass or skip for `ok: true`.

20 unit tests in `scripts/tests/release-evidence-validate.test.ts`
exercise every path through the validator with on-disk fixtures, no
network or git history required. The fixture suite covers:

- empty / malformed version files
- all-three-agree, two-agree-one-disagree, one-missing, all-missing
- SBOM detection by filename vs by directory contents
- BUILD_MANIFEST detection by filename vs by directory contents
- SLSA provenance detection via `.intoto.jsonl` vs via paired BUILD_MANIFEST

### 3. Required-check manifest update

`.github/required-checks.txt` adds a new line:

```
release-evidence.yml|Release Evidence
```

so the existing `required-check-names-guard.yml` workflow enforces that
the gate's job name exists. This does not change branch protection on
`main`; the guard is a self-consistency check on the manifest, not a
required status check.

### 4. Documentation

- `docs/slsa.md` — replaced "achieved today" with the truthful
  "partial coverage as of v0.14.11-canary.3". Added an explicit
  "What is enforced today" section that points at the gate, and a
  "What is not yet enforced" section that names the SBOM-generation
  and cosign-signing gaps as future work.
- `docs/plans/tasks/release-evidence.md` (this file) — the plan, in the
  same per-release format as `release-evidence-v0.14.11-canary.3.md`.
- `VERSION` — fixed from `0.14.11-canary.1` to `0.14.11-canary.3` so
  all three version sources agree. Without this fix the gate correctly
  fails the validator on every release commit; the fix demonstrates
  the gate's effectiveness.

## Test results

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| `scripts/tests/release-evidence-validate.test.ts` | 20 | 20 | 0 |

## Quality gates

| Gate | Status |
|------|--------|
| `bun test scripts/tests/release-evidence-validate.test.ts` | 20/20 pass |
| Validator catches real bugs | yes (VERSION mismatch detected) |
| Validator returns non-zero on failure | yes (`process.exit(1)`) |

## Version consistency

| Source | Version |
|--------|---------|
| `package.json` | 0.14.11-canary.3 |
| `Cargo.toml` | 0.14.11-canary.3 |
| `VERSION` | 0.14.11-canary.3 (was 0.14.11-canary.1, fixed in this slice) |

## Open follow-ups (not in this slice)

1. **SBOM generation inside `release.yml`** — the gate currently verifies
   that an SBOM *exists*, but `release.yml` does not yet run
   `cargo-cyclonedx sbom` to produce one. Adding that step is a separate
   slice.
2. **Cosign signing of release binaries** — the gate validates provenance
   metadata exists but does not verify that the binaries themselves are
   signed. Wiring `cosign sign-blob` with keyless OIDC into `release.yml`
   is a separate slice.
3. **Per-release evidence doc auto-generation** — replace the
   hand-written `release-evidence-v0.14.11-canary.3.md` format with a
   generated report produced by the gate at release time. The current
   slice lays the foundation; the generator is a follow-up.

## How to verify locally

```bash
# Validator should currently fail because release.yml has not yet run
# (release commit not yet made). It catches the real bug we fixed.
bun run scripts/release-evidence-validate.ts

# Run the unit tests
bun test scripts/tests/release-evidence-validate.test.ts
```

When the first real `release:` commit is pushed, the gate runs end-to-end:
`release.yml` ships artifacts, `release-evidence.yml` queries them,
the validator returns 0, the check turns green.
