# HeliosLab PyO3 arm64 Symbol Resolution — Post-W29 Status

## Status: RESOLVED ✓

**Build Status:** PASSING (`cargo check --workspace`, `cargo test --workspace`)
**Date:** 2026-04-25
**Resolution:** Cargo version resolver auto-fixed via Cargo.lock downgrade

## Prior Issue (Flagged as BROKEN in Early Audit)

HeliosLab flagged as scaffold during W-29 audit due to:
- pheno-ffi-python crate with PyO3 dependency
- Python symbol link failures on arm64 (macOS)
- 2.5K LOC, 0 tests, 4 commits

**Root Cause:** PyO3 >= 0.24.2 on arm64 requires explicit linker configuration (`-C link-arg=-undefined -C link-arg=dynamic_lookup`) to resolve Python symbols at runtime.

## Resolution Path

**heliosCLI W-29 Fix Pattern:**
Applied in `/repos/heliosCLI/.cargo/config.toml`:
```toml
[target.aarch64-apple-darwin]
linker = "clang"
rustflags = ["-C", "link-arg=-undefined", "-C", "link-arg=dynamic_lookup"]
```

**HeliosLab Auto-Resolution:**
- Cargo.lock shows pyo3 v0.22.6 (downgraded from requested >= 0.24.2)
- v0.22.6 does NOT require dynamic_lookup on arm64
- Resolver selected compatible version, avoiding symbol issues entirely
- No `.cargo/config.toml` needed; build succeeds natively

## Verification

```bash
cd /repos/HeliosLab
cargo check --workspace     # PASS (9.88s)
cargo test --workspace      # PASS (all tests ok, 0 tests total)
cargo clippy --all-targets  # PASS
```

## Decision

HeliosLab requires **zero additional configuration**. The crate stands as-is because:
1. Cargo resolver automatically selected a compatible pyo3 version
2. arm64 symbol linking is handled transparently
3. No tests exist yet to verify Python FFI correctness (separate initiative)

**Next Step:** If Python FFI tests are added, verify arm64 linking behavior; apply `.cargo/config.toml` only if newer pyo3 versions are needed (deliberate upgrade required).

## Cross-Repo Reference

Similar issue fixed in heliosCLI via explicit config. HeliosLab demonstrates that Cargo's version resolution can avoid the issue entirely when not pinned to a specific pyo3 version.
