# Polyglot Config Core v1 Proposal

## Summary
Create a reusable module packaging scaffold for `polyglot-config-core-v1` with a single source of
truth contract describing public surfaces for:
- Rust core
- Go FFI
- Python FFI

## Goals
- Define and freeze public module boundaries for v1.
- Establish semver behavior for stable consumer expectations.
- Provide a lightweight consumer guide and validation hook.

## Non-Goals
- Shipping complete runtime implementations for all language bindings.
- Backward compatibility shims for pre-v1 APIs.

## Initial Packaging Scope
- `contracts/polyglot-config-core.contract.json` as canonical contract metadata.
- `docs/guides/polyglot-config-core-module.md` for consumer usage and compatibility expectations.
- `scripts/validate_polyglot_contract.sh` for local/CI contract presence checks.

## Success Criteria
- Contract exists and is machine-readable JSON.
- Consumer guide exists with installation and compatibility notes.
- Validation script exits non-zero when required artifacts are missing.
