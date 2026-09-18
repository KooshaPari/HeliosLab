# SLSA Build Attestation

This repository publishes build provenance for release artifacts in
accordance with [SLSA (Supply-chain Levels for Software Artifacts)][slsa]
Build specifications. SLSA provenance allows downstream consumers to
verify that an artifact was built from the expected source repository,
at the expected commit, by the expected build platform.

## Target Level

**Current target: SLSA Build L2 (achieved today)**

The release pipeline is hosted on GitHub Actions, an isolated build
platform that is owned and administered by GitHub. Provenance is
generated automatically for every published release using
[`slsa-framework/slsa-github-generator`][slsa-gh-gen] and the
`attest-build-provenance` action. Provenance is signed by a GitHub-
hosted OIDC token and stored in the [GitHub Artifact Attestations][ghaa]
log alongside the artifact.

## Workflow

The CI workflow lives at
[`.github/workflows/release-attestation.yml`](../.github/workflows/release-attestation.yml)
and is triggered:

- Automatically on every `release: published` event.
- Manually via `workflow_dispatch` for ad-hoc provenance generation.

## Verification

```bash
gh attestation verify <artifact> --owner KooshaPari
```

## References

- [SLSA Framework][slsa]
- [`slsa-framework/slsa-github-generator`][slsa-gh-gen]
- [GitHub Artifact Attestations][ghaa]

[slsa]: https://slsa.dev
[slsa-gh-gen]: https://github.com/slsa-framework/slsa-github-generator
[ghaa]: https://docs.github.com/en/security/supply-chain-security/artifact-attestations
