# SBOM Generation Inline in `release.yml` (Slice 6 / F7)

## What F7 delivers

The slice-3 release-evidence gate requires an SBOM artifact, but
`release.yml` did not produce one. Until now the only SBOM producer was
the monthly `sbom-refresh.yml`, which is a separate run on a separate
cadence. A release commit could therefore pass the evidence gate using
an SBOM generated weeks earlier from a different tree.

This adds an `sbom` job to `.github/workflows/release.yml` so the SBOM
and the release commit are produced by the same workflow run.

## The scope decision, and why

There was a real fork here, so it is recorded rather than glossed over.

`release.yml` is a **Rust-only** pipeline. Its steps are `cargo build
--release`, `cargo test --release`, `cargo publish`. The narrow reading
of F7 is therefore "SBOM for the crate we publish", which would mean a
Rust-only generator.

The repo is **polyglot** though, with both `Cargo.lock` and `bun.lock`
committed. And the gate is weaker than it looks: `checkArtifactPresence`
in `scripts/release-evidence-validate.ts` matches only on **basename**,
accepting any of `SBOM.cdx.json`, `SBOM.spdx.json`, `sbom.cdx.json`, or
`sbom.spdx.json`. It does not inspect the format or what the SBOM
covers. A Rust-only SBOM would have satisfied that check while leaving
the Node dependency graph undescribed, which is precisely the kind of
green-but-vacuous signal this ladder exists to remove.

Rather than install and pin two generators, this uses
`anchore/sbom-action` with `path: .`. Syft auto-detects every supported
lockfile it finds, so one invocation covers both trees. This is also the
action and `artifact-name` that `templates/stage-gates.yml` already
standardizes on, so the repo is not growing a second convention.

## Verified, not assumed

**Both action pins were resolved against the GitHub API**, not copied
from neighbouring workflows:

- `actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11` (v4.1.1)
- `anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610` (v0)

This matters: the SHA that appears on the existing `release.yml`
checkout line, `11bd71901bbe5b1630ceaa73d27597364c9af683`, **does not
exist** (API returns `422 No commit found`). The real v4.1.1 is the
`b4ffde65...` above. A draft of this branch initially copied the bad
SHA from `release-evidence.yml` and was caught only because the pins
were checked rather than trusted. This is the same class of bug as the
`setup-bun` pin that broke the release-evidence gate on every main SHA
before F5's doc follow-up fixed it.

**The artifact name satisfies the gate.** The real
`checkArtifactPresence` was run against five artifact trees, including
two negative controls. All five behaved correctly:

| Fixture | Expected | Result |
|---|---|---|
| `sbom/sbom.spdx.json` | pass | pass |
| `sbom/sbom.spdx.json` nested with its `.zip` | pass | pass |
| `sbom/SBOM.cdx.json` | pass | pass |
| only `BUILD_MANIFEST.txt` + `provenance.intoto.jsonl` | fail | fail |
| only `sbom.json` + `sbom.xml` (near-miss names) | fail | fail |

The negative controls matter, because a name-level check is exactly the
kind of thing that passes for the wrong reason.

**The scan really does cover both trees.** Syft 1.52.0 was run over
this repository with the same arguments the job uses. The result is
SPDX-2.3 with **1489 packages**: 999 `pkg:npm`, 182 `pkg:cargo`, 175
`pkg:github`, 52 `pkg:pypi`, 8 `pkg:golang`, with the first-party crate
present. So the "one invocation, both trees" claim above is measured.

## Why the job is conditionally gated

The `sbom` job carries the **same `if` expression** as the `release`
job. That is deliberate rather than incidental.

On a non-release push to `main`, the `release` job is skipped, so the
workflow still reports overall success with nothing having run. An
always-on `sbom` job would change that: the evidence gate would start
finding an SBOM on commits that were never released, which is a weaker
claim than "this release shipped an SBOM" while looking like a stronger
one.

## Known limits

- The evidence gate still validates only the **filename**. The SBOM's
  contents are not checked, and this change does not fix that. A
  follow-up should have the validator parse the SPDX JSON and assert
  that the first-party component is present.
- The job is not exercised by CI, because it is gated on a
  `release:` / `chore(release)` commit message, which does not occur on
  ordinary branches. It will first execute on the next real release.
  Local Syft output was used to verify it instead.
- `sbom-refresh.yml` is left in place for the non-release cadence.

## Files changed

| File | Change |
|---|---|
| `.github/workflows/release.yml` | New conditionally-gated `sbom` job |
| `docs/plans/WBS.md` | F-ladder row and F7 section updated with the scope decision and measured scan result |

## How to verify locally

```bash
# Pins resolve to real commits
gh api repos/actions/checkout/commits/b4ffde65f46336ab88eb53be808477a3936bae11
gh api repos/anchore/sbom-action/commits/e22c389904149dbc22b58101806040fa8d37a610

# The job emits a name the gate accepts
bun test scripts/tests/release-evidence-validate.test.ts

# The scan covers both dependency trees
syft dir:. -o spdx-json=out.json
# then assert pkg:npm and pkg:cargo both appear under
# packages[].externalRefs[referenceType=purl].referenceLocator
```
