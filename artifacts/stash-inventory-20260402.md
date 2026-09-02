# Stash Inventory 2026-04-02
1. Ran `git stash show --stat stash@{0}` from `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp` to capture the high-level diff summary.
1. Captured the raw diff via `git stash show -p stash@{0}` for future reference (stored under `/tmp/heliosapp-stash.diff`).
1. Inspected `deps-changelog.json` with `test -f deps-changelog.json && cat deps-changelog.json` to confirm it exists and currently contains an empty `entries` array; it is referenced by multiple scripts and should remain tracked.

## Summary

- `stash@{0}` touches ~49 files (1,566 insertions / 822 deletions) and spans governance workflows `.github/workflows/sast-full.yml` / `.github/workflows/sast-quick.yml`, tooling configs (`.oxfmtrc.json`, `.pre-commit-config.yaml`), runtime surfaces under `apps/runtime/` (audit sinks, fetching logic, runtime ops and terminal wiring, runtime tests), lockfiles (`bun.lock`, `apps/desktop/tsconfig.tsbuildinfo`, `apps/desktop/tests/unit/startup_latency.test.ts`, `apps/colab-renderer/package.json`), docs/registry/test helpers, and JSON schema snapshots.
- The stash also deletes numerous docs/test files under the runtime suite, indicating it is a mixed governance/runtime batch, not just a lockfile tweak.
- `deps-changelog.json` exists at the repo root and currently holds `{ "entries": [] }`, confirming it is a tracked artifact referenced from PRD/PLAN/scripts; it should remain under version control.

## Next Non-PR Action

1. Keep the stash untouched; do not apply or pop it until a follow-up lane is ready.
2. Reference this artifact (`artifacts/stash-inventory-20260402.md`) whenever the stash becomes part of a new split or cleanup lane.
