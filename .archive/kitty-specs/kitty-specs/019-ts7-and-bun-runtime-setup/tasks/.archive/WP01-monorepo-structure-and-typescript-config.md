---
work_package_id: WP01
title: Monorepo Structure and TypeScript Configuration
lane: "planned"
dependencies: []
base_branch: main
base_commit: ""
created_at: '2026-02-27T00:00:00+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 0 - Foundation
assignee: ''
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Monorepo Structure and TypeScript Configuration

## Objectives & Success Criteria

- Establish Bun workspace monorepo with `apps/desktop` and `apps/runtime` packages.
- Configure TypeScript 7 strict-mode as the single source of truth via `tsconfig.base.json`.
- Ensure `bun install` resolves all workspace packages and cross-references without manual path hacks.
- Ensure `bunfig.toml` enforces minimum Bun version and deterministic install behavior.

Success criteria:
- `bun install` completes in under 30 seconds on warm cache and resolves all workspace packages.
- `bun run typecheck` exits 0 with no diagnostics on a correctly typed codebase.
- Workspace cross-references between `apps/desktop` and `apps/runtime` resolve correctly.
- No `@ts-ignore`, `@ts-expect-error`, or suppression directives exist in any file.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/019-ts7-and-bun-runtime-setup/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/019-ts7-and-bun-runtime-setup/spec.md`

Constraints:
- Bun >= 1.2 is the minimum supported runtime version.
- TypeScript 7 strict mode with all flags enabled (no implicit any, strict null checks, strict).
- No globally installed tools other than Bun itself.
- Deterministic builds: identical inputs must produce identical outputs.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Create root package.json with Bun workspace declarations

- Purpose: establish the monorepo root that Bun uses for workspace resolution and dependency hoisting.
- Steps:
  1. Create `package.json` at repository root with `"workspaces": ["apps/*"]` declaration.
  2. Set `"private": true` to prevent accidental publishing.
  3. Declare `"engines": { "bun": ">=1.2" }` for minimum Bun version enforcement.
  4. Add `typescript` (TS7 version) as a root devDependency.
  5. Add placeholder scripts for `dev`, `build`, `typecheck` that will be fleshed out in WP02.
  6. Validate the file with `bun install --dry-run` to confirm workspace resolution.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json`
- Acceptance:
  - `bun install` resolves workspace packages without errors.
  - `package.json` is valid JSON and passes `bun pm ls` workspace listing.
- Parallel: No.

### Subtask T002 - Create bunfig.toml with workspace resolution and install settings

- Purpose: configure Bun-specific workspace resolution, lockfile behavior, and install determinism.
- Steps:
  1. Create `bunfig.toml` at repository root.
  2. Configure `[install]` section with `lockfile = true` and `frozen = false` (development mode; CI will use frozen).
  3. Configure workspace resolution settings if Bun supports them in `bunfig.toml`.
  4. Add any registry configuration needed for prerelease dependencies (placeholder for spec 020).
  5. Document each setting with inline comments explaining its purpose.
  6. Validate by running `bun install` and confirming the lockfile is generated correctly.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/bunfig.toml`
- Acceptance:
  - `bunfig.toml` is valid TOML and Bun reads it without warnings.
  - Install behavior matches documented settings.
- Parallel: No.

### Subtask T003 - Create tsconfig.base.json with TS7 strict-mode settings

- Purpose: establish the shared TypeScript configuration that all workspace packages extend.
- Steps:
  1. Create `tsconfig.base.json` at repository root.
  2. Enable all strict-mode flags: `"strict": true`, `"noImplicitAny": true`, `"strictNullChecks": true`, `"noImplicitReturns": true`, `"noFallthroughCasesInSwitch": true`, `"noUncheckedIndexedAccess": true`.
  3. Set `"target"` and `"module"` appropriate for Bun runtime (ESNext/ESNext or Bun-specific targets).
  4. Configure `"moduleResolution"` for Bun compatibility (bundler or node16+).
  5. Set `"composite": true` and `"declaration": true` for project references if using TS project references.
  6. Add `"paths"` section with placeholder path aliases (e.g., `"@helios/runtime"`, `"@helios/desktop"`).
  7. Ensure `"skipLibCheck": false` for maximum strictness.
  8. Validate by running `tsc --showConfig` and confirming all flags are active.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/tsconfig.base.json`
- Acceptance:
  - All strict-mode flags are enabled and verified via `tsc --showConfig`.
  - No `@ts-ignore` or `@ts-expect-error` needed in any existing code.
- Parallel: No.

### Subtask T004 - Create apps/desktop package and tsconfig

- Purpose: establish the ElectroBun desktop shell workspace package with its own package manifest and TypeScript config.
- Steps:
  1. Create `apps/desktop/package.json` with package name `@helios/desktop`, private flag, and required dependencies (ElectroBun).
  2. Create `apps/desktop/tsconfig.json` that extends `../../tsconfig.base.json`.
  3. Override only workspace-specific settings (e.g., `outDir`, `rootDir`, `include` paths).
  4. Add a reference to `apps/runtime` if using TS project references.
  5. Create `apps/desktop/src/index.ts` with a minimal ElectroBun bootstrap entry point.
  6. The entry point should import from `@helios/runtime` to validate cross-workspace resolution.
  7. Validate: `bun run typecheck` passes for the desktop package in isolation.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/package.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tsconfig.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/index.ts`
- Acceptance:
  - Package resolves in workspace listing.
  - TypeScript config extends base without overriding strict flags.
  - Entry point compiles without errors.
- Parallel: Yes (after T003 base config is in place).

### Subtask T005 - Create apps/runtime package and tsconfig

- Purpose: establish the core runtime workspace package where protocol, session, and audit logic will live.
- Steps:
  1. Create `apps/runtime/package.json` with package name `@helios/runtime`, private flag, and initial devDependencies (Vitest).
  2. Create `apps/runtime/tsconfig.json` that extends `../../tsconfig.base.json`.
  3. Override only workspace-specific settings (e.g., `outDir`, `rootDir`, `include` paths).
  4. Create `apps/runtime/src/index.ts` with a minimal runtime bootstrap entry point that exports a version constant.
  5. Validate: `bun run typecheck` passes for the runtime package in isolation.
  6. Validate: `apps/desktop` can import from `@helios/runtime` via workspace resolution.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/package.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tsconfig.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/index.ts`
- Acceptance:
  - Package resolves in workspace listing.
  - Cross-workspace imports work from desktop to runtime.
  - TypeScript config extends base correctly.
- Parallel: Yes (after T003 base config is in place).

## Test Strategy

- Run `bun install` and verify all workspace packages are resolved.
- Run `bun run typecheck` and verify zero errors on correctly typed code.
- Introduce a deliberate type error in `apps/runtime/src/index.ts` and verify `bun run typecheck` fails with a clear diagnostic.
- Verify cross-workspace imports resolve: `apps/desktop` importing from `@helios/runtime`.
- Verify `bun pm ls` shows both workspace packages.

## Risks & Mitigations

- Risk: TypeScript 7 prerelease has breaking changes in strict-mode flag semantics.
- Mitigation: Pin exact TS7 version; track via spec 020 prerelease registry once available.
- Risk: ElectroBun prerelease has incompatible build entry point.
- Mitigation: Use minimal entry point; defer full ElectroBun integration to build script WP.
- Risk: Bun workspace resolution differs from npm workspaces in edge cases.
- Mitigation: Test cross-workspace resolution explicitly in validation steps.

## Review Guidance

- Confirm `tsconfig.base.json` has ALL strict flags enabled with no overrides in child configs.
- Confirm no `@ts-ignore`, `@ts-expect-error`, or suppression directives exist anywhere.
- Confirm workspace packages resolve cross-references without path hacks.
- Confirm `bunfig.toml` settings are documented with inline comments.
- Confirm root `package.json` is private and has correct workspace paths.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
