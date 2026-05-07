# Polyglot Config Core v1 Tasks

## Phase 1: Scaffold
- [x] Create change proposal under `docs/changes/shared-modules/polyglot-config-core-v1/`.
- [x] Create task tracker for module packaging bootstrap.

## Phase 2: Contract
- [x] Add `contracts/polyglot-config-core.contract.json` with declared public surfaces:
  Rust core, Go FFI, Python FFI.
- [x] Define semver policy for breaking vs non-breaking changes.

## Phase 3: Consumer Documentation
- [x] Add concise module consumer guide:
  `docs/guides/polyglot-config-core-module.md`.

## Phase 4: Validation
- [x] Add `scripts/validate_polyglot_contract.sh` for required artifact checks.
- [x] Execute validator once and record output in session report.
