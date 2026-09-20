# SLSA Build Attestation

This repository publishes build provenance for release artifacts in
accordance with [SLSA (Supply-chain Levels for Software Artifacts)][slsa]
Build specifications. SLSA provenance allows downstream consumers to
verify that an artifact was built from the expected source repository,
at the expected commit, by the expected build platform.

## Target Level

**Current target: SLSA Build L2 — partial coverage as of v0.14.11-canary.3**

The release pipeline is hosted on GitHub Actions, an isolated build
platform that is owned and administered by GitHub. Provenance is
generated automatically for every published release using
[`slsa-framework/slsa-github-generator`][slsa-gh-gen] and the
`attest-build-provenance` action. Provenance is signed by a GitHub-
hosted OIDC token and stored in the [GitHub Artifact Attestations][ghaa]
log alongside the artifact.

### What is enforced today

The [release-evidence gate][release-evidence-gate] (workflow
`.github/workflows/release-evidence.yml`) is triggered by:

- `workflow_run` events from `Release` and `Release Attestation` workflows
  completing on `main`, or
- manual `workflow_dispatch` with an optional commit SHA (defaults to the
  workflow's `HEAD`).

The gate is **post-merge** by design: release evidence (SBOM,
`BUILD_MANIFEST.txt`, SLSA provenance) is produced by `release.yml` and
`release-attestation.yml`, which themselves only fire on push to `main`.
Pre-merge validation cannot reach those artifacts. The gate validates:

1. Version consistency between `VERSION`, `package.json`, and `Cargo.toml`.
2. A `Release` workflow run completed successfully on the same SHA, and a
   `Release Attestation` workflow run completed successfully on the same
   SHA.
3. Release + attestation artifacts downloaded into a single directory
   contain an SBOM (`SBOM.cdx.json` / `SBOM.spdx.json`),
   a `BUILD_MANIFEST.txt`, and an `.intoto.jsonl` provenance document.

`workflow_run` is used as the trigger so the gate cannot race against an
in-flight `release.yml` run; by the time the gate starts, the upstream
runs have a known `conclusion` value that the gate reads. Artifacts are
downloaded from the matched runs using
`actions/github-script@v7`'s `listWorkflowRunArtifacts` and
`downloadWorkflowRunArtifact` calls, so the validator scans the union of
actual artifact files rather than container names.

### What is not yet enforced

SBOM generation and cosign signing of binaries are not yet wired into
`release.yml`; today the gate verifies that the existing artifacts carry
the expected file names. Closing that gap is tracked in
[`docs/plans/tasks/release-evidence.md`][release-evidence-plan].

## Workflow

The CI workflow lives at
[`.github/workflows/release-attestation.yml`](../.github/workflows/release-attestation.yml)
and is triggered:

- Automatically on every `release: published` event.
- Manually via `workflow_dispatch` for ad-hoc provenance generation.

The validation gate lives at
[`.github/workflows/release-evidence.yml`](../.github/workflows/release-evidence.yml)
and is triggered:

- Automatically via `workflow_run` whenever `Release` or
  `Release Attestation` completes on `main`.
- Manually via `workflow_dispatch` with an optional commit SHA for
  ad-hoc re-validation of any commit.

## Verification

```bash
gh attestation verify <artifact> --owner KooshaPari
```

## References

- [SLSA Framework][slsa]
- [`slsa-framework/slsa-github-generator`][slsa-gh-gen]
- [GitHub Artifact Attestations][ghaa]
- [Release evidence gate][release-evidence-gate]
- [Release evidence plan][release-evidence-plan]

[slsa]: https://slsa.dev
[slsa-gh-gen]: https://github.com/slsa-framework/slsa-github-generator
[ghaa]: https://docs.github.com/en/security/supply-chain-security/artifact-attestations
[release-evidence-gate]: ../.github/workflows/release-evidence.yml
[release-evidence-plan]: plans/tasks/release-evidence.md
