# Release Evidence: v0.14.11-canary.3

**Date:** 2026-09-19
**Branch:** main (pending merge of PRs #195-#199)

---

## PRs in this release

| PR | Title | Status | Code Gates |
|----|-------|--------|------------|
| #195 | fix(ci): unblock red gates, restore redacted org, clear debris | OPEN | Green |
| #196 | fix(gates): six protocol topics + file split + Infisical fixes | OPEN | Green |
| #197 | feat(pty-pool): Windows ConPTY backend | OPEN | Green |
| #199 | feat(runtime): terminal-first vertical slice + durability layer | OPEN | Green |

## What was built

### 1. Protocol SSOT (PR #196)
- Implemented `lane.attach.started/failed`, `lane.cleanup.started/failed`, `session.terminate.started/failed` across all four normative layers
- Formal spec (`topics.json`), contract schema with conditional-required clauses, runtime `TOPICS`, bus lifecycle handlers, parity matrix
- Split `request-handlers.ts` (545 lines) into two files to stay under 500-line gate
- Fixed `BusState` type bug

### 2. Windows ConPTY backend (PR #197)
- `pty_windows.zig` (~460 lines): native Windows terminal via ConPTY API
- Non-blocking reads via `PeekNamedPipe` + `ReadFile`
- Correct teardown ordering (ClosePseudoConsole before pipe handles)
- Comptime backend selection in `main.zig`
- End-to-end smoke test verified (cmd.exe VT output through ring buffer)

### 3. Terminal-first vertical slice (PR #199)
- `VerticalSliceDriver`: subscribes to lane lifecycle topics, spawns real PTY per lane, pipes stdout to renderer
- `RecordingRendererAdapter`: headless CI testing of renderer binding
- Fixed `spawnPty` handle leak (SpawnResult now carries handle)
- Fixed `InMemoryLocalBus.subscribe()` no-op stub

### 4. Durability layer (PR #199)
- `DurabilityLayer`: wires CheckpointScheduler, Watchdog, CrashLoopDetector, SafeMode into createRuntime()
- Opt-in via `dataDir` option
- Checkpoints written periodically (60s) and on activity bursts
- Crash loop detection (3+ in 60s) triggers safe mode
- Final checkpoint on shutdown

### 5. CI fixes (PRs #195, #196)
- Infisical runner: `blacksmith-2vcpu-ubuntu-2204` → `ubuntu-latest`
- Infisical CLI URL: Cloudsmith → `artifacts-cli.infisical.com`
- Redacted org name restored

## Test results

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| Recovery (all) | 132 | 132 | 0 |
| Vertical slice | 4 | 4 | 0 |
| Protocol parity | 152 | 152 | 0 |
| Durability layer | 8 | 8 | 0 |
| **Total (affected)** | **296** | **296** | **0** |

## Quality gates

| Gate | Status |
|------|--------|
| `tsc --noEmit` | Clean (0 new errors) |
| `biome check` | Clean |
| Protocol parity | 152/152 |
| Vertical slice integration | 4/4 |
| Durability layer integration | 8/8 |
| Recovery unit tests | 132/132 |
| ConPTY smoke test | Pass |

## Version consistency

| Source | Version |
|--------|---------|
| `package.json` | 0.14.11-canary.3 |
| `Cargo.toml` | 0.14.11-canary.3 |
| `VERSION` | 0.14.11-canary.3 (updated) |

## Blockers for actual release

1. **INFISICAL_TOKEN** — must be added to repo Settings → Secrets for CI to pass
2. **SONAR_TOKEN** — must be added for SonarCloud analysis
3. **PR merge** — all four PRs need to be merged to main
4. **Release commit** — needs `release:` or `chore(release)` prefix to trigger `release.yml`
5. **Tag push** — `v0.14.11-canary.3` triggers `build-release.yml`

## Release process (per ADR-0003)

1. Add `INFISICAL_TOKEN` and `SONAR_TOKEN` to repo settings
2. Merge PRs #195, #196, #197, #199 to main
3. Verify all CI checks pass on main
4. Create release commit: `chore(release): v0.14.11-canary.3`
5. Tag: `git tag -a v0.14.11-canary.3 -m "Release v0.14.11-canary.3"`
6. Push: `git push origin main --tags`
7. Verify `release.yml` and `build-release.yml` complete
8. Create GitHub Release from tag with CHANGELOG entry
