# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Root `ARCHITECTURE.md` + `SSOT.md` for auditor canonical-doc detection (`BENCH-002`).
- `docs/SCORECARD.md` WORK_DAG for phenotype audit lifts (baseline overall 82 / grade B).
- Soft CI job `docs-canonical` asserting required governance docs exist.
- Multi-stage `Dockerfile` + `make docker-smoke` + soft CI `docker-smoke` (local build only; no registry secrets) (`BENCH-004`, L27).
- SPEC/SSOT env table + clap `BENCHORA_DB` / regression-threshold contract tests (`BENCH-003`, L20 Config).
- Exit-code + `benchora.report.v1` monitoring docs + `tests/monitoring_contract_test.rs` (`BENCH-005`, L29).
- Soft `benchora --help` subcommand contract tests + CLI rustdoc / API_REFERENCE polish (`BENCH-006`, L15).

### Changed

- `SPEC.md` lists `BENCH-002` governance traces and SSOT pointers.
- `SPEC.md` / `SSOT.md` / `ARCHITECTURE.md` document config precedence for DB path and compare threshold.
- `SPEC.md` / `SSOT.md` / `ARCHITECTURE.md` document CLI exit codes and report schema (`BENCH-005`).
- `src/cli` / crate rustdoc and `docs/API_REFERENCE.md` index all six CLI subcommands (`BENCH-006`).
- Evidence-based audit re-score after T1–T5 (#79–#83): overall **82 → 85** / grade B
  (`BENCH-007`); lifts L8/L4/L20/L27/L29/L15 only where soft evidence supports.

## [0.2.1] - 2026-07-22

### Added

- `ARCHITECTURE.md` documenting crate layout, module responsibilities, and data flow.
- `API_REFERENCE.md` with full public API surface documentation.

### Changed

- Decomposed `mutate` module into focused submodules (extract, score, strategy).
- Decomposed `compare` module into focused submodules (engine, report, threshold).
- Extracted shared time utilities into `time_utils` module (DRY refactor).
- Streaming SHA256 hash computation replaces monolithic read for large files.
- `XddError` now implements `Display` via `#[derive(Display)]` for user-friendly messages.
- Removed unused dependencies: `quickcheck`, `async-trait`, `tokio`.
- Added 37 new tests across mutate, compare, and core modules.

### Changed

- README Install prefers `cargo install benchora --locked` after crates.io publish of `0.2.0`.
- Work State reflects tagged Release + published crate.

## [0.2.0] - 2026-07-19

First tagged release. Crate version matches `Cargo.toml`. Git tag `v0.2.0`,
GitHub Release, and crates.io publish (`benchora` 0.2.0) are complete.

### Changed

- CI `cargo test` is now gating (`continue-on-error` removed from the test job).
- Standalone `cargo-deny` workflow no longer soft-fails (aligned with CI deny job).
- README Work State: crate version `0.2.0` prepared for tag/Release (T1) and
  crates.io (T2).
- Install docs led with `cargo install --path . --locked` until crates.io
  publish; post-publish README prefers `cargo install benchora --locked`.
- Release attestation workflow no longer soft-fails empty binary staging
  (`find â€¦ || true` / `if-no-files-found: warn`); requires `target/release/benchora`.
- Getting-started docs corrected from stale `gauge` crate naming to `benchora` /
  `phenotype_xdd_lib`.
- Action SHA pins: `actions/checkout` unified to v7.0.0 where pinned.

### Operator notes

See [docs/guides/cutting-a-release.md](docs/guides/cutting-a-release.md) for the
next version cut. `v0.2.0` tag, Release, and crates.io publish are done.

[Unreleased]: https://github.com/KooshaPari/Benchora/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/KooshaPari/Benchora/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/KooshaPari/Benchora/releases/tag/v0.2.0
