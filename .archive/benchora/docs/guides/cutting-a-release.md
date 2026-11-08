# Cutting a Benchora release

Operator runbook for tagging `v0.2.0` (T1) and publishing to crates.io (T2).
Do **not** run these until `main` has the release-ready CHANGELOG section and
local quality gates are green.

## Preconditions

```bash
cd /path/to/Benchora   # worktree or canonical after merge
git checkout main
git pull --rebase origin main
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
cargo build --release --locked --bin benchora
grep -A2 '## \[0.2.0\]' CHANGELOG.md   # section must exist with a date
```

Confirm `Cargo.toml` `version = "0.2.0"` matches the CHANGELOG heading.

## T1 — git tag + GitHub Release (no crates.io yet)

Exact commands (annotated tag preferred):

```bash
git tag -a v0.2.0 -m "Benchora v0.2.0"
git push origin v0.2.0

gh release create v0.2.0 \
  --title "v0.2.0" \
  --notes-file <(sed -n '/## \[0.2.0\]/,/^## \[/p' CHANGELOG.md | sed '$d')
```

Alternate notes from the CHANGELOG section by hand:

```bash
gh release create v0.2.0 --title "v0.2.0" --notes-from-tag
```

Publishing the GitHub Release triggers
[`.github/workflows/release-attestation.yml`](../../.github/workflows/release-attestation.yml),
which builds `target/release/benchora`, stages provenance artifacts, and uploads
them. Verify the workflow run succeeds before treating the release as complete.

Do **not** run `cargo publish` in T1.

## T2 — crates.io publish

For `0.2.0` this step is **done** (`benchora` on crates.io). For the next
version, after tagging:

```bash
cargo login          # once per machine / token
cargo publish --dry-run --locked
cargo publish --locked
```

After a successful publish:

1. Prefer `cargo install benchora --locked` in README Install.
2. Update Work State: crates.io = published; keep git tag / Release as done.

## Rollback / mistakes

- Wrong tag before push: `git tag -d v0.2.0` (local only).
- Wrong tag already pushed: do **not** force-delete without explicit operator
  approval; prefer a patch tag (`v0.2.1`) and a forward CHANGELOG entry.
- Never `cargo publish` a version that does not match the git tag / CHANGELOG.

## Related

- [CHANGELOG.md](../../CHANGELOG.md)
- [docs/slsa.md](../slsa.md) — attestation / provenance
- [README.md](../../README.md) — install honesty until crates.io lands
