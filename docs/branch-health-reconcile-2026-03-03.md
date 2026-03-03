# Branch Health Reconciliation Plan (Non-Destructive)

Date: 2026-03-03

## Current Snapshot

- `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp-colab`
  - `HEAD` vs `origin/main`: ahead 1, behind 8
  - `HEAD` vs `upstream/main`: ahead 1, behind 0
- `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp`
  - `HEAD` (`heliosapp-upstream-recon`) vs `upstream/main`: ahead 9, behind 0
  - `HEAD` vs `origin/main`: ahead 13, behind 510

## Goals

- Preserve all local commits.
- Avoid force-push and history rewrites.
- Reconcile with upstream first, then sync fork/origin safely.

## Exact Steps

### A) heliosApp-colab

1. Create a safety branch from current state:
   ```bash
   cd /Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp-colab
   git switch -c chore/branch-health-colab-20260303
   ```
2. Update remotes:
   ```bash
   git fetch --all --prune
   ```
3. Rebase local commit(s) on top of `origin/main` (non-destructive; local rewrite only):
   ```bash
   git rebase origin/main
   ```
4. Resolve conflicts, continue rebase, and run checks:
   ```bash
   git status
   git rebase --continue
   ```
5. Push as a PR branch:
   ```bash
   git push -u origin chore/branch-health-colab-20260303
   ```
6. Merge by PR after checks pass (no direct push to `main`).

Fallback (if rebase is too noisy): use merge without rewriting commits.
```bash
git rebase --abort
git merge --no-ff origin/main
git push -u origin chore/branch-health-colab-20260303
```

### B) heliosApp

1. Create an integration branch from `heliosapp-upstream-recon`:
   ```bash
   cd /Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp
   git switch heliosapp-upstream-recon
   git switch -c chore/branch-health-heliosapp-20260303
   ```
2. Confirm upstream sync (already ahead-only) and refresh:
   ```bash
   git fetch --all --prune
   git rev-list --left-right --count upstream/main...HEAD
   ```
3. Merge upstream changes if any appear (non-destructive):
   ```bash
   git merge --no-ff upstream/main
   ```
4. Reconcile fork/origin divergence via PR path instead of force sync:
   ```bash
   git push -u origin chore/branch-health-heliosapp-20260303
   ```
5. Open PR to `origin/main` and merge normally after checks pass.
6. If `origin/main` must absorb large upstream drift first, do it in a dedicated sync branch:
   ```bash
   git switch -c chore/origin-main-sync-from-upstream-20260303 upstream/main
   git push -u origin chore/origin-main-sync-from-upstream-20260303
   ```
7. Merge the sync PR first, then rebase/merge feature branches on top of the updated `origin/main`.

## Notes

- Do not use `git reset --hard`, `git push --force`, or history-rewriting operations on shared branches.
- Keep PR scope small: branch-health sync and task changes should be separate PRs when possible.

## TS Debt Reduction Evidence (2026-03-03)

### Slice 1: `index.tsx` + `GitSlate.tsx`

- Metric: `any`/`as any` hotspots in targeted files.
- Before:
  - `src/renderers/ivde/index.tsx`: 6
  - `src/renderers/ivde/slates/GitSlate.tsx`: 13
- After:
  - `src/renderers/ivde/index.tsx`: 3
  - `src/renderers/ivde/slates/GitSlate.tsx`: 0
- Net change: 19 -> 3 (84.2% reduction in targeted debt markers).

### Slice 2: local terminal/settings hotspots

- `src/main/utils/terminalManager.ts`
  - Before: 668 lines
  - After: 626 lines
  - Change: -42 lines (parser extraction to `src/main/utils/terminalCommandParser.ts`)
- `src/renderers/ivde/settings/PluginSettings.tsx`
  - Before: 629 lines
  - After: 496 lines
  - Change: -133 lines (custom loader extraction to `src/renderers/ivde/settings/CustomSettingsLoader.tsx`)

### Typecheck evidence

- Baseline command: `bun run typecheck`
- Baseline log: `/tmp/colab-typecheck-before2.log`
- After-change command: `bun run typecheck`
- After-change log: `/tmp/colab-typecheck-after.log`

#### Before/After counts (diff-friendly)

| metric | before | after | delta |
|---|---:|---:|---:|
| total `error TS` lines | 639 | 610 | -29 |
| `TS7006` (implicit any parameter) | 53 | 44 | -9 |
| `TS7031` (implicit any destructuring) | 25 | 3 | -22 |

#### Target file impact

| file | before errors | after errors | delta |
|---|---:|---:|---:|
| `src/renderers/ivde/slates/GitSlate.tsx` | 73 | 66 | -7 |
| `src/renderers/ivde/index.tsx` | 64 | 64 | 0 |
| `src/renderers/ivde/settings/PluginSettings.tsx` | 9 | 9 | 0 |
| `src/main/utils/terminalManager.ts` | 0 | 0 | 0 |

#### Notes

- `src/renderers/ivde/index.tsx`: `TS7006` reduced from 1 to 0 (typed webview `ref` callback).
- `src/renderers/ivde/slates/GitSlate.tsx`: `TS7006` reduced from 7 to 0 (typed commit/file/reduce callbacks).
- Additional high-frequency class reduction was delivered in `src/main/index.ts`: `TS7031` reduced from 25 to 3 via typed RPC payload destructuring.
