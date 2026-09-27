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

This matters: the two workflows do not agree on which checkout
they pin. `release.yml` line 26 and `release-evidence.yml` line 74
both use `11bd71901bbe5b1630ceea73d27597364c9af683`, which the
API resolves to commit `Prepare 4.2.2 Release (#1953)`, i.e.
**v4.2.2**, while the `b4ffde65...` above is v4.1.1. Both
annotations previously read `# v4.1.1`, so the tree was pinning v4.2.2
while claiming v4.1.1. Every `# v4.1.1` annotation on that SHA has now
been corrected to `# v4.2.2` repo-wide: 13 lines across 11 workflow
files, bringing all 19 pins of this SHA to one reading. The pins
themselves are left alone, since v4.2.2 is the newer of the two and both
resolve. A draft of this branch
initially copied a pin between the two workflows and was caught
only because the pins were checked against the API rather than
trusted. That is the same class of bug as the `setup-bun` pin that
broke the release-evidence gate on every main SHA before F5's
doc follow-up fixed it.

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
| `.github/workflows/release-evidence.yml` | Extract nested artifact archives so the evidence gate can actually see them |
| `scripts/tests/release-evidence-extract.test.ts` | Regression coverage for the download layout and extraction step |
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

## Follow-up: the evidence step never unpacked the artifacts

Emitting the SBOM was necessary but not sufficient. The download steps in
`release-evidence.yml` write each artifact to
`<downloadDir>/<artifact.name>/<artifact.name>.zip`, while the extraction
step globbed only `<downloadDir>/*.zip`. That pattern matches nothing in
that layout, so nothing was ever unpacked and `checkArtifactPresence` only
ever saw `.zip` container names. A release run could produce a perfectly
good `sbom.spdx.json` and still fail `sbom-present`. The gate was therefore
broken rather than protective, and specifically a false-negative one: it
failed closed on every run, including runs that shipped a correct SBOM.
The same blind spot hid `BUILD_MANIFEST` and the SLSA provenance
(`.intoto.jsonl`) files, since `checkArtifactPresence` reads the
downloaded tree for exactly those three things. CVP is unaffected:
`scripts/cvp-evidence-validate.ts` reads a pre-existing report from
`.gate-reports/cvp-evidence.json` and never touches the download
directory.

Because the gate triggers on `workflow_run` for `main`, it is post-merge
by design and cannot stop a release from shipping. The real consequence
was a red `Release Evidence` check on every post-merge run, leaving
published-but-unevidenced releases behind, rather than releases being
blocked outright.

The step now walks the whole tree with
`find <dir> -type f -name '*.zip'` and unpacks each archive beside itself.

The earlier verification missed this because it called
`checkArtifactPresence` directly against a hand-built directory. It never
exercised the download layout or the extraction step, which is precisely
the seam where the bug lived. `scripts/tests/release-evidence-extract.test.ts`
now covers it, including:

- the positive case, where the recursive walk yields `sbom-present: pass`;
- a negative control running the **original** top-level-only traversal over
  the same fixture, which must still fail, proving the fixture reproduces
  the real download layout;
- no-SBOM and near-miss-name controls, which must still fail;
- a check that every archive is unpacked, not only the first;
- a Windows-only case that runs the verbatim workflow bash under Git bash
  with GNU `find` first on `PATH`. Windows ships a `find.exe` that shadows
  GNU `find`, which otherwise produces a misleading local failure. The
  GitHub runner is Ubuntu, where `find` is GNU `find`.

