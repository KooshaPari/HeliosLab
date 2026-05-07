# Polyglot Config Core Module Guide

## What This Is
`polyglot-config-core` is the shared contract and packaging surface for configuration logic consumed
across Rust, Go, and Python boundaries.

## Public Surfaces
- Rust core: `crates/polyglot-config-core`
- Go FFI: `crates/polyglot-config-goffi`
- Python FFI: `crates/polyglot-config-pyffi`

Contract source of truth:
- `contracts/polyglot-config-core.contract.json`

## Compatibility Rules
- Follow semver strictly.
- Breaking any public surface requires a major version bump.
- Additive, backward-compatible changes are minor.
- Internal-only fixes are patch.

## Consumer Checklist
1. Pin to a compatible major version.
2. Review contract changes before upgrading.
3. Run `scripts/validate_polyglot_contract.sh` in CI to verify required artifacts are present.
