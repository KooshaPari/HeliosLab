---
work_package_id: WP02
title: Build, Dev, and Typecheck Scripts with Path Aliases
lane: "planned"
dependencies:
- WP01
base_branch: main
base_commit: ""
created_at: '2026-02-27T00:00:00+00:00'
subtasks:
- T006
- T007
- T008
- T009
- T010
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

# Work Package Prompt: WP02 - Build, Dev, and Typecheck Scripts with Path Aliases

## Objectives & Success Criteria

- Deliver working `bun dev`, `bun run build`, and `bun run typecheck` scripts.
- Configure path aliases that resolve identically in Bun runtime, build toolchain, and test runner.
- Validate the entire build infrastructure end-to-end with automated tests.

Success criteria:
- `bun dev` starts a hot-reloading development server that reflects changes in `apps/runtime` without full restart.
- `bun run build` produces a launchable ElectroBun desktop artifact with zero errors and zero warnings.
- `bun run typecheck` catches 100% of deliberately introduced type errors and exits non-zero.
- Path aliases (`@helios/runtime`, `@helios/desktop`) resolve correctly in build output, runtime, and tests.
- All scripts complete within performance targets: dev cold start < 5s, typecheck < 15s.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/019-ts7-and-bun-runtime-setup/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/019-ts7-and-bun-runtime-setup/spec.md`
- WP01 artifacts: `package.json`, `bunfig.toml`, `tsconfig.base.json`, per-workspace configs

Constraints:
- Scripts must work on macOS as primary platform.
- No globally installed tools other than Bun.
- Build must fail on any TypeScript error or warning.
- Path aliases must not require pre-build steps or generated files.
- Keep script files under 350 lines each.

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T006 - Implement bun dev script with hot-reload

- Purpose: enable fast iterative development with live reloading across workspace packages.
- Steps:
  1. Add `"dev"` script to root `package.json` that starts the ElectroBun development server.
  2. Configure the dev server to watch all workspace packages (`apps/desktop/src/**`, `apps/runtime/src/**`).
  3. Ensure changes in `apps/runtime` trigger reload in the desktop shell without full restart.
  4. Add `"dev"` scripts to each workspace `package.json` for per-package development if needed.
  5. Configure source maps for debugging in the dev environment.
  6. Test cold start time: measure from command invocation to interactive state.
  7. Test hot-reload latency: measure from file save to visible change in the shell.
  8. Document the dev server startup in comments and ensure the script is self-explanatory.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (update scripts)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/package.json` (update scripts)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/package.json` (update scripts)
- Acceptance:
  - `bun dev` launches a functional terminal surface in the ElectroBun shell.
  - Editing a file in `apps/runtime/src/` triggers a visible reload within 2 seconds.
  - Dev server cold start completes in under 5 seconds on 4-core/8GB reference hardware.
- Parallel: No.

### Subtask T007 - Implement bun run build script

- Purpose: produce a production-optimized ElectroBun desktop artifact suitable for local execution.
- Steps:
  1. Add `"build"` script to root `package.json` that builds the full desktop application.
  2. Configure the build to compile all workspace packages in dependency order.
  3. Enable TypeScript type checking as part of the build (build fails on type errors).
  4. Configure production optimizations: minification, dead code elimination where supported by ElectroBun.
  5. Ensure the build output is a self-contained launchable artifact.
  6. Add `"build"` scripts to each workspace `package.json` for per-package builds if needed.
  7. Verify the built artifact launches and renders a functional terminal surface.
  8. Measure build time and document it for performance baseline tracking.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (update scripts)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/package.json` (update scripts)
- Acceptance:
  - `bun run build` exits 0 with zero TypeScript errors and zero warnings.
  - The build artifact is launchable and renders a terminal surface.
  - Build output does not contain source maps (production mode).
- Parallel: No.

### Subtask T008 - Implement bun run typecheck standalone gate

- Purpose: enable type checking as a standalone discrete gate independent of the build pipeline.
- Steps:
  1. Add `"typecheck"` script to root `package.json` that runs `tsc --noEmit` across all workspace packages.
  2. Use TypeScript project references or workspace-aware invocation to check all packages.
  3. Ensure the script uses the exact same `tsconfig` settings as the build.
  4. Verify the script exits non-zero when a type error exists in any workspace package.
  5. Verify the script provides clear diagnostics: file path, line number, error message.
  6. Add `"typecheck"` scripts to each workspace `package.json` for per-package checking.
  7. Measure typecheck time on the full monorepo and document the baseline.
  8. Ensure typecheck completes in under 15 seconds on 4-core/8GB reference hardware.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (update scripts)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/package.json` (update scripts)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/package.json` (update scripts)
- Acceptance:
  - `bun run typecheck` exits 0 on a correctly typed codebase.
  - Introducing `const x: number = "hello"` in any workspace fails the check with clear output.
  - Typecheck completes in under 15 seconds.
- Parallel: No.

### Subtask T009 - Configure path aliases with build and runtime resolution

- Purpose: enable ergonomic cross-workspace imports via aliases that resolve in all contexts.
- Steps:
  1. Define path aliases in `tsconfig.base.json` under `"paths"`: `"@helios/runtime/*": ["./apps/runtime/src/*"]`, `"@helios/desktop/*": ["./apps/desktop/src/*"]`.
  2. Ensure Bun runtime resolves these aliases natively (Bun reads `tsconfig.json` paths).
  3. Verify the build toolchain resolves aliases in the production build output.
  4. Verify Vitest resolves aliases in test files.
  5. Add a cross-workspace import in `apps/desktop/src/index.ts` that uses the `@helios/runtime` alias.
  6. Validate the import works in dev mode, build mode, and test mode.
  7. Document the alias convention and any resolver configuration needed.
  8. If Bun does not natively resolve tsconfig paths, add the minimal resolver config needed in `bunfig.toml` or a Bun plugin.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/tsconfig.base.json` (update paths)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/tsconfig.json` (verify extends)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tsconfig.json` (verify extends)
- Acceptance:
  - `import { version } from "@helios/runtime"` works in desktop entry point.
  - Alias resolves in `bun dev`, `bun run build`, and `bun test` contexts.
  - No manual path mapping or pre-build generation needed.
- Parallel: No.

### Subtask T010 - Add validation tests for workspace, aliases, typecheck, and build

- Purpose: lock the build infrastructure behavior with automated tests that prevent regressions.
- Steps:
  1. Create `apps/runtime/tests/unit/setup/` directory for infrastructure validation tests.
  2. Add a Vitest test that imports from `@helios/runtime` using the path alias and verifies the import resolves.
  3. Add a Vitest test that imports the runtime version constant and asserts it matches `package.json` version.
  4. Add a shell script test (or Vitest with `exec`) that runs `bun run typecheck` and asserts exit code 0.
  5. Add a shell script test that introduces a deliberate type error, runs typecheck, and asserts exit code non-zero.
  6. Add a test that validates `bun pm ls --all` lists both workspace packages.
  7. Add a test that validates the build output exists and is non-empty after `bun run build`.
  8. Ensure all tests run via `bun test` and are included in the Vitest config.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/setup/workspace.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/setup/typecheck.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/setup/build.test.ts`
- Acceptance:
  - All validation tests pass with `bun test`.
  - Tests catch workspace resolution failures, alias misconfiguration, and typecheck regressions.
  - Test suite runs in under 30 seconds.
- Parallel: Yes (after T006-T009 script interfaces are defined).

## Test Strategy

- Vitest tests validate workspace resolution, path alias resolution, and infrastructure contracts.
- Shell-level tests validate typecheck and build exit codes.
- Performance assertions: dev cold start < 5s, typecheck < 15s, install < 30s.
- Regression tests: deliberate type error must fail typecheck; deliberate alias break must fail resolution.

## Risks & Mitigations

- Risk: ElectroBun dev server API changes between prerelease versions.
- Mitigation: Minimal dev server config; pin ElectroBun version; track via spec 020.
- Risk: Path alias resolution differs between Bun runtime and TypeScript compiler.
- Mitigation: Test alias resolution in all three contexts (dev, build, test) explicitly.
- Risk: Hot-reload latency exceeds acceptable threshold for developer experience.
- Mitigation: Measure and document; optimize watcher configuration if needed.

## Review Guidance

- Confirm `bun dev` achieves hot-reload without full restart on runtime file changes.
- Confirm `bun run build` fails on type errors (not just silently produces broken output).
- Confirm `bun run typecheck` is independent of the build and can run without building.
- Confirm path aliases work in all three contexts without extra tooling.
- Confirm validation tests are comprehensive and catch real regressions.

## Activity Log

- 2026-02-27T00:00:00Z -- system -- lane=planned -- Prompt created.
