---
work_package_id: WP01
title: Monorepo Structure, TypeScript Config, and Bun Workspace Setup
lane: "done"
dependencies: []
base_branch: main
base_commit: b40c283fd2e256b2ca09d4f1735a05cdcfe9685e
created_at: '2026-02-27T10:39:24.683112+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
- T007
phase: Phase 0 - Foundation
assignee: ''
agent: "claude-opus"
shell_pid: "18701"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Monorepo Structure, TypeScript Config, and Bun Workspace Setup

## Objectives & Success Criteria

- Establish the Bun workspace monorepo root with two packages: `apps/desktop` and `apps/runtime`.
- Configure TypeScript 7 strict mode as the shared base config for all workspace packages.
- Ensure `bun install` resolves all dependencies cleanly and workspace cross-references work without manual path hacks.
- Set up `bunfig.toml` for workspace resolution and minimum Bun version enforcement.

Success criteria:
- `bun install` completes with zero errors and links workspace packages.
- `bun run typecheck` exits 0 on the scaffolded codebase.
- Path aliases defined in tsconfig resolve correctly for cross-workspace imports.
- No `@ts-ignore`, `@ts-expect-error`, or suppression directives in any config or source file.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/019-ts7-and-bun-runtime-setup/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/019-ts7-and-bun-runtime-setup/spec.md`

Constraints:
- TypeScript 7 strict mode is mandatory. All strict flags must be enabled in `tsconfig.base.json`.
- No globally installed tools other than Bun itself (NFR-004).
- Deterministic builds: same input must produce same output.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Create root package.json with Bun workspace declarations

- Purpose: Define the monorepo root that Bun uses for workspace resolution, dependency hoisting, and script entry points.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (or update if it exists) with `"workspaces"` array pointing to `"apps/desktop"` and `"apps/runtime"`.
  2. Add `"engines"` field specifying minimum Bun version (>= 1.2).
  3. Add TypeScript 7 as a root `devDependency` with a pinned version.
  4. Add placeholder scripts: `"dev"`, `"build"`, `"typecheck"` that delegate to workspace-level scripts.
  5. Add `"private": true` to prevent accidental publishing.
  6. Verify the file is valid JSON and parseable by Bun.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json`
- Acceptance:
  - `bun install` recognizes both workspace packages.
  - The `engines` field documents the minimum Bun version.
  - TypeScript 7 is available to all workspace packages via hoisting.
- Parallel: No.

### Subtask T002 - Create bunfig.toml with workspace resolution config

- Purpose: Configure Bun-specific behavior including workspace resolution strategy, install preferences, and version enforcement.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/bunfig.toml`.
  2. Set `[install]` section with `peer = false` and `production = false` defaults for dev ergonomics.
  3. Configure workspace resolution to prefer linked packages over registry versions.
  4. Add any registry configuration needed for prerelease dependency access (placeholder for spec 020).
  5. Document each setting with inline comments explaining the rationale.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/bunfig.toml`
- Acceptance:
  - Bun reads the config file during `bun install` and respects all settings.
  - Workspace resolution prefers local packages over registry versions.
- Parallel: No.

### Subtask T003 - Create tsconfig.base.json with TS7 strict mode

- Purpose: Establish the shared TypeScript configuration that all workspace packages extend, ensuring maximum type safety across the monorepo.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/tsconfig.base.json`.
  2. Enable `"strict": true` which activates `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`.
  3. Set `"target"` to a modern ES target compatible with Bun (e.g., `"ESNext"`).
  4. Set `"module"` and `"moduleResolution"` appropriate for Bun workspace resolution (e.g., `"ESNext"` / `"bundler"`).
  5. Enable `"declaration": true` and `"declarationMap": true` for cross-workspace type checking.
  6. Enable `"skipLibCheck": false` to catch issues in declaration files.
  7. Configure `"paths"` section with path aliases for common cross-workspace imports (e.g., `"@helios/runtime"`, `"@helios/desktop"`).
  8. Set `"noUncheckedIndexedAccess": true` for additional safety.
  9. Set `"exactOptionalPropertyTypes": true` if supported by TS7.
  10. Ensure no `@ts-ignore` or `@ts-expect-error` directives are needed in any generated config.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/tsconfig.base.json`
- Acceptance:
  - All strict flags are enabled; no relaxations.
  - Path aliases resolve correctly when referenced from workspace packages.
  - The config is valid and `tsc --showConfig` renders the expected merged result.
- Parallel: No.

### Subtask T004 - Create apps/desktop package scaffold

- Purpose: Set up the `apps/desktop` workspace package with its own package.json, tsconfig, and minimal ElectroBun entry point.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/package.json` with package name `@helios/desktop`, version, and ElectroBun as a dependency.
  2. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tsconfig.json` extending `../../tsconfig.base.json` with `"rootDir": "src"`, `"outDir": "dist"`, and any desktop-specific compiler options.
  3. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/index.ts` with a minimal ElectroBun window creation entry point that opens a terminal surface.
  4. Ensure the package declares its workspace dependency on `@helios/runtime` using workspace protocol (`"workspace:*"`).
  5. Add desktop-specific scripts: `"dev"`, `"build"`, `"typecheck"`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/package.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tsconfig.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/index.ts`
- Acceptance:
  - `bun run typecheck` in the desktop package exits 0.
  - The package is recognized as a workspace member by the root.
  - Cross-workspace imports from `@helios/runtime` resolve via path aliases.
- Parallel: Yes (after T003 base config is stable).

### Subtask T005 - Create apps/runtime package scaffold

- Purpose: Set up the `apps/runtime` workspace package with its own package.json, tsconfig, and minimal entry point for core runtime logic.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/package.json` with package name `@helios/runtime`, version, and any runtime-specific dependencies.
  2. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tsconfig.json` extending `../../tsconfig.base.json` with `"rootDir": "src"`, `"outDir": "dist"`, and runtime-specific paths.
  3. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/index.ts` with a minimal runtime bootstrap that exports core types and a health check function.
  4. Add runtime-specific scripts: `"dev"`, `"build"`, `"typecheck"`, `"test"`.
  5. Add Vitest as a devDependency for the runtime package test suite.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/package.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tsconfig.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/index.ts`
- Acceptance:
  - `bun run typecheck` in the runtime package exits 0.
  - Vitest is available for test execution.
  - The package exports are importable from `apps/desktop` via workspace resolution.
- Parallel: Yes (after T003 base config is stable).

### Subtask T006 - Configure path aliases and verify cross-workspace resolution

- Purpose: Ensure that path aliases defined in tsconfig files resolve correctly for both the TypeScript compiler and Bun's runtime module resolver.
- Steps:
  1. Define path aliases in `tsconfig.base.json` `"paths"` section: `"@helios/runtime/*": ["apps/runtime/src/*"]`, `"@helios/desktop/*": ["apps/desktop/src/*"]`.
  2. Add corresponding entries in per-package tsconfig files if needed for package-local resolution.
  3. Create a small cross-workspace import test: `apps/desktop/src/index.ts` imports a type or function from `@helios/runtime`.
  4. Verify that `bun run typecheck` resolves the alias correctly.
  5. Verify that `bun run` (runtime execution) also resolves the alias correctly, not just `tsc`.
  6. Document the alias convention in a code comment in `tsconfig.base.json`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/tsconfig.base.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tsconfig.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tsconfig.json`
- Acceptance:
  - Cross-workspace imports via `@helios/runtime/...` compile and resolve at runtime.
  - No manual pre-build or linking steps required.
- Parallel: No.

### Subtask T007 - Validate install and typecheck end-to-end

- Purpose: Confirm the full monorepo setup works as an integrated unit before handing off to WP02.
- Steps:
  1. Run `bun install` from the repo root and confirm zero errors, all workspace packages linked.
  2. Run `bun run typecheck` from the repo root and confirm zero errors across all packages.
  3. Introduce a deliberate type error in `apps/runtime/src/index.ts`, re-run typecheck, confirm it fails with clear file/line diagnostic.
  4. Fix the error and re-run to confirm green.
  5. Verify no circular workspace dependencies exist by checking Bun's resolution output.
  6. Check that workspace packages can import each other's types without build artifacts (source-level resolution).
- Files:
  - All files created in T001-T006.
- Acceptance:
  - Clean install + typecheck cycle completes with zero errors.
  - Deliberate errors produce clear diagnostics.
  - No circular dependencies.
- Parallel: No.

## Test Strategy

- Verify `bun install` workspace resolution with zero errors.
- Verify `bun run typecheck` strict mode catches all type errors.
- Verify path alias resolution in both compiler and runtime contexts.
- Verify no suppression directives exist in any file.

## Risks & Mitigations

- Risk: TypeScript 7 prerelease has breaking tsconfig changes.
- Mitigation: Pin to a specific TS7 version; document upgrade path in plan.md.
- Risk: Bun workspace resolution conflicts with TypeScript path aliases.
- Mitigation: Test both tsc and Bun runtime resolution in T006.

## Review Guidance

- Confirm all strict-mode flags are enabled in tsconfig.base.json with no relaxations.
- Confirm workspace resolution works end-to-end without manual linking.
- Confirm no `@ts-ignore`, `@ts-expect-error`, or suppression directives.
- Confirm path aliases resolve for both tsc and Bun runtime.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-02-27T10:39:24Z – claude-opus – shell_pid=18701 – lane=doing – Assigned agent via workflow command
- 2026-02-27T10:41:48Z – claude-opus – shell_pid=18701 – lane=for_review – Ready for review: Bun workspace monorepo with TS strict mode, cross-workspace imports verified
- 2026-03-01T13:25:15Z – claude-opus – shell_pid=18701 – lane=done – Merged to main
