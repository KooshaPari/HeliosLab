# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-04-25

### Fixed
- **pheno-ffi-python**: Enabled stable ABI (abi3) for PyO3 bindings, resolving Miniforge arm64 libpython symbol blocker (W-72, PR #57, commit 2c2faf1)

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
