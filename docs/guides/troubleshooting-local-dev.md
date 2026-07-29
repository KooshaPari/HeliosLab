# Troubleshooting local development

Short fixes for common issues when working on this repo locally.

## ENOSPC / disk full

If builds or tests fail with **ENOSPC** or the disk is nearly full, free space and clear transient caches:

- **Project `.tmp`** — Remove or trim contents under the repo’s `.tmp` directory when safe (it holds scratch and generated artifacts).
- **Bun package cache** — Run `bun pm cache rm` (or clear Bun’s global cache location for your install) to reclaim space from cached packages.
- **`apps/runtime` test scratch** — Runtime tests may write under `apps/runtime`; clean any leftover test output or temp dirs there after failed runs.

Then retry the command that failed.

## Bun version

CI and local tooling expect the Bun version pinned in `package.json` (`packageManager`, e.g. `bun@1.2.20`). Install that exact version (for example via [Bun’s install docs](https://bun.sh/docs/installation)) so scripts and tests behave the same as in automation.

## Secrets tests

Secrets-related tests may use files under **`.tmp/runtime-secrets-tests`**. That path is for local scratch only: **do not commit** it or add real secrets; keep it gitignored and delete when done testing.
