# Contributing to Benchora

Thanks for your interest in contributing! Benchora is a Rust-based benchmarking and performance-testing framework for the Phenotype ecosystem.

## Prerequisites

- Rust toolchain (see `rust-toolchain.toml` for pinned version)
- `cargo` (bundled with Rust)
- `pre-commit` (`pip install pre-commit`)

## Getting Started

```bash
git clone https://github.com/KooshaPari/Benchora.git
cd Benchora
cargo build
pre-commit install
```

## Development Workflow

1. **Branch from `main`**: `git checkout -b feat/<topic>` or `fix/<topic>`.
2. **Write tests first**: Add criterion benches under `benches/` and unit tests under `tests/` or `src/`.
3. **Trace requirements**: Reference `BENCH-NNN` IDs in test names and doc comments per `SPEC.md`.
4. **Run locally before pushing**:
   ```bash
   cargo fmt --all -- --check
   cargo clippy --all-targets --all-features -- -D warnings
   cargo test --all-features
   cargo bench --no-run
   ```
5. **Commit style**: Conventional commits (`feat:`, `fix:`, `docs:`, `bench:`, `chore:`).
6. **Open a PR**: Describe the change, link related specs, and include benchmark deltas where applicable.

## Code Standards

- `clippy` clean, zero warnings.
- `rustfmt` formatted (no manual override).
- Public APIs documented with `///` rustdoc.
- No `unwrap()` / `expect()` outside tests and benches.
- New benches use `criterion`; avoid bespoke timing harnesses.

## Reporting Issues

Open an issue with reproduction steps, environment (OS, Rust version), and observed vs expected behavior.

## License

By contributing you agree your work is licensed under the project `LICENSE`.
