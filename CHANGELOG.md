# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `deny.toml` cargo-deny policy ([graph] / [advisories] / [licenses] / [bans] / [sources]) so the `cargo-deny` CI job has a checked-in config to enforce
- Windows ConPTY backend (`pty_windows.zig`) for native terminal support on Windows without POSIX PTY ([#197](https://github.com/KooshaPari/HeliosLab/pull/197))
- Terminal-first vertical slice: lane lifecycle wired to real PTY + renderer via `VerticalSliceDriver` ([#199](https://github.com/KooshaPari/HeliosLab/pull/199))
- Durability layer: `DurabilityLayer` wires `CheckpointScheduler`, `Watchdog`, `CrashLoopDetector`, `SafeMode` into `createRuntime()` ([#199](https://github.com/KooshaPari/HeliosLab/pull/199))
- Protocol topics `lane.attach.started/failed`, `lane.cleanup.started/failed`, `session.terminate.started/failed` implemented across contract, runtime, and parity matrix ([#196](https://github.com/KooshaPari/HeliosLab/pull/196))
- `RecordingRendererAdapter` for headless CI testing of renderer binding ([#199](https://github.com/KooshaPari/HeliosLab/pull/199))
- `pty_pool_last_spawn_error` and `pty_pool_last_hresult` exports for bridge diagnosis ([#197](https://github.com/KooshaPari/HeliosLab/pull/197))

### Changed
- `SpawnResult` now carries the spawned process handle; `PtyManager` exposes `getProcess()` ([#199](https://github.com/KooshaPari/HeliosLab/pull/199))
- `InMemoryLocalBus.subscribe()` dispatches to real subscribers with per-handler failure isolation ([#199](https://github.com/KooshaPari/HeliosLab/pull/199))
- `build.zig` no longer vetoes Windows builds; backend selected at comptime ([#197](https://github.com/KooshaPari/HeliosLab/pull/197))

### Fixed
- Infisical CI runner: switched from `blacksmith-2vcpu-ubuntu-2204` to `ubuntu-latest` ([#196](https://github.com/KooshaPari/HeliosLab/pull/196))
- Infisical CLI install URL updated from defunct Cloudsmith repo to `artifacts-cli.infisical.com` ([#196](https://github.com/KooshaPari/HeliosLab/pull/196))
- `request-handlers.ts` split into two files to stay under 500-line gate ([#196](https://github.com/KooshaPari/HeliosLab/pull/196))
- `BusState` type bug: `ctx.setState("idle")` corrected to `ctx.setState({ session: "detached" })` ([#196](https://github.com/KooshaPari/HeliosLab/pull/196))
- Redacted org name restored in `Cargo.toml`, `.mergify.yml`, `.github/FUNDING.yml` ([#195](https://github.com/KooshaPari/HeliosLab/pull/195))

## [0.1.1] - 2026-04-25

### Added
- Test suite: 54 tests across pheno-core, pheno-db, pheno-crypto, pheno-cli, and FFI bindings (Go/Python)
- SECURITY.md and CONTRIBUTING.md governance guides
- OpenSSF Scorecard audit workflow
- Canonical .gitattributes for LF normalization

## [0.14.11-canary.1] - 2026-03-29

### Added
- phenotype-config core functionality
- Feature flag lifecycle management
- Secret value storage abstractions
- Version inspection and rollout state tracking
- Terminal UI for operational workflows
