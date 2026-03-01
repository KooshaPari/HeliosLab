# Co(lab) Project Constitution

Non-negotiable toolchain and architecture decisions for the co(lab) desktop application.
Changes to this document require explicit team consensus.

## Runtime

- **Runtime**: Bun 1.2.20+
- **Desktop framework**: ElectroBun (Zig-based, 12MB base)
- **Language**: TypeScript 5.4+ with `strict: true`
- **Target**: ES2022, Bundler module resolution

## Testing

- **Framework**: Vitest
- **Command**: `task test` or `bunx vitest run`
- **Coverage**: Required for new modules

## Formatting & Linting

- **Formatter**: oxfmt (OXC/VoidZero stack)
- **Linter**: oxlint + oxlint-tsgolint for type-aware checks
- **Line width**: 100 characters
- **Indent**: 2 spaces (tabs forbidden)
- **Config**: `.oxlintrc.json` at repo root

## Task Runner

- **Tool**: Taskfile.yml (go-task v3.x)
- **Quality lanes**: quality, quality:quick, quality:ci, quality:pre-push, quality:release-lint
- **Alias**: `check` → `quality`
- **CI gate**: `task quality:ci` (non-mutating)

## Quality Lane Hierarchy

- `quality` = canonical full check (fmt + test + lint, mutating)
- `quality:quick` = fast readonly (no file writes)
- `quality:ci` = non-mutating PR gate
- `quality:release-lint` = release validation
- `quality:pre-push` = git hook target
- `check` = alias for quality

## Library Preferences

- **Prefer bun builtins** over npm packages for: filesystem (Bun.file, Bun.write), HTTP (fetch), subprocess (Bun.spawn)
- **Prefer node: imports** over npm shims: `node:fs`, `node:path`, `node:crypto`
- **Forbidden**: Dependencies that duplicate bun/node builtins (fs-extra, node-fetch, cross-env)
- **Required review**: Any new dependency > 100KB or with > 5 transitive deps

## Architecture Principles

- **Feature flags**: Use `HELIOS_SURFACE_EDITOR` build var for mode switching
- **RPC pattern**: ElectroBun RPCSchema — `bun.requests` (renderer→main), `webview.messages` (main→renderer)
- **State management**: Bus-driven state machine (LocalBus + InMemoryLocalBus)
- **Worktree discipline**: Canonical folders on `main` only; feature work in `-wtrees/` directories
- **File size**: Target ≤ 350 lines per file; ≤ 500 hard limit

## Performance Targets

- **App binary**: ≤ 25MB base (ElectroBun target)
- **Dev build**: < 10 seconds
- **Test suite**: < 30 seconds
- **Inference TTFT**: < 100ms (MLX), < 200ms (llama.cpp fallback)
