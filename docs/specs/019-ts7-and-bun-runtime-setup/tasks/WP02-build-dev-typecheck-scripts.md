---
work_package_id: WP02
title: Build, Dev, and Typecheck Scripts with Path Aliases and Tests
lane: "done"
dependencies:
- WP01
base_branch: 019-ts7-and-bun-runtime-setup-WP01
base_commit: 76a235c583c88d28f17942d53484e7e2d6882d48
created_at: '2026-02-27T11:19:14.050454+00:00'
subtasks:
- T008
- T009
- T010
- T011
- T012
- T013
phase: Phase 0 - Foundation
assignee: ''
agent: "wp02-agent"
shell_pid: "22412"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 - Build, Dev, and Typecheck Scripts with Path Aliases and Tests

## Objectives & Success Criteria

- Deliver working `bun dev`, `bun run build`, and `bun run typecheck` commands for the full monorepo.
- Ensure hot-reload propagates runtime changes into the running desktop dev session.
- Validate path alias resolution works end-to-end in dev, build, and typecheck contexts.
- Add foundational tests for the build infrastructure itself.

Success criteria:
- `bun dev` launches the ElectroBun desktop shell with a functional terminal surface and hot-reloads on file changes.
- `bun run build` produces a launchable desktop artifact with zero errors and zero warnings.
- `bun run typecheck` catches 100% of deliberately introduced type errors.
- Path aliases resolve identically in dev, build, and runtime contexts.
- NFR targets met: install < 30s, dev cold start < 5s, typecheck < 15s.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/019-ts7-and-bun-runtime-setup/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/019-ts7-and-bun-runtime-setup/spec.md`
- WP01 output: Root configs, workspace packages, tsconfig files, path aliases.

Constraints:
- No globally installed tools other than Bun.
- Build must be deterministic: same source produces same artifact.
- Hot-reload must not require full restart for runtime changes.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP02`

## Subtasks & Detailed Guidance

### Subtask T008 - Implement bun dev script with hot-reload

- Purpose: Provide a single-command development experience that launches the ElectroBun desktop shell and watches for file changes across all workspace packages.
- Steps:
  1. Create or update the root `package.json` `"dev"` script to orchestrate both `apps/desktop` and `apps/runtime` dev processes.
  2. Configure Bun's built-in watch mode or an appropriate file watcher for TypeScript source files across workspaces.
  3. Wire the `apps/desktop` dev entry point to launch an ElectroBun window with a terminal surface placeholder.
  4. Configure hot-reload so that changes in `apps/runtime/src/` are detected and propagated to the running desktop process without full restart.
  5. Add error overlay or console output for TypeScript errors encountered during hot-reload.
  6. Test: edit a file in `apps/runtime/src/`, confirm the change is reflected in the running desktop shell within 2 seconds.
  7. Test: introduce a type error during dev, confirm the error is reported clearly without crashing the dev server.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (script entries)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/package.json` (dev script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/package.json` (dev script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/index.ts` (dev entry point)
- Acceptance:
  - `bun dev` from root starts both workspace dev processes.
  - Hot-reload works for cross-workspace changes.
  - Dev server cold start < 5 seconds (NFR-002).
- Parallel: No.

### Subtask T009 - Implement bun run build production artifact

- Purpose: Produce a production-optimized, launchable ElectroBun desktop artifact from the monorepo source.
- Steps:
  1. Create or update the root `package.json` `"build"` script to orchestrate production builds for all workspace packages.
  2. Configure the `apps/runtime` build to produce bundled output suitable for consumption by `apps/desktop`.
  3. Configure the `apps/desktop` build to produce an ElectroBun-packaged desktop application.
  4. Ensure path aliases are resolved during the build process (not left as unresolved imports in the output).
  5. Enable production optimizations: minification, tree-shaking (if supported by ElectroBun toolchain), source map generation.
  6. Verify the build output is self-contained and can be launched without the source tree.
  7. Verify the build produces zero TypeScript errors and zero warnings.
  8. Document the build output location and how to launch the artifact.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (build script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/package.json` (build script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/package.json` (build script)
- Acceptance:
  - `bun run build` produces a launchable desktop artifact.
  - Zero TypeScript errors and zero build warnings.
  - Build output resolves all path aliases (no broken imports).
- Parallel: No.

### Subtask T010 - Implement bun run typecheck as standalone gate

- Purpose: Provide a discrete type-checking command that can run independently of the build, suitable for CI gate use and local pre-push validation.
- Steps:
  1. Create or update the root `package.json` `"typecheck"` script to run `tsc --noEmit` across all workspace packages.
  2. Ensure the typecheck runs in strict mode matching `tsconfig.base.json` settings.
  3. Ensure the typecheck covers all workspace packages, not just the root.
  4. Configure the command to exit non-zero on any type error with clear file/line diagnostics.
  5. Verify the typecheck runs independently of build output (no dependency on prior `bun run build`).
  6. Measure execution time and confirm it meets the < 15 second NFR on reference hardware.
  7. Test: introduce a type error in each workspace package and confirm the typecheck catches all of them.
  8. Test: verify that `@ts-ignore` or `@ts-expect-error` directives (if any existed) would be caught by the strict config.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (typecheck script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/package.json` (typecheck script)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/package.json` (typecheck script)
- Acceptance:
  - `bun run typecheck` exits 0 on correct code, non-zero on any type error.
  - Covers all workspace packages.
  - Runs in < 15 seconds on reference hardware.
  - Independent of build output.
- Parallel: No.

### Subtask T011 - Path alias resolution validation tests

- Purpose: Ensure that path aliases defined in tsconfig work correctly in all contexts: TypeScript compiler, Bun dev server, Bun build, and Bun runtime.
- Steps:
  1. Create test fixtures in `apps/runtime/src/` that export typed functions and interfaces.
  2. Create import statements in `apps/desktop/src/` that use path aliases (`@helios/runtime/...`) to import from runtime.
  3. Write a Vitest test in `apps/runtime/tests/` that imports via path alias and verifies the imported module is functional.
  4. Verify `bun run typecheck` resolves the aliases without errors.
  5. Verify `bun dev` resolves the aliases at runtime during hot-reload.
  6. Verify `bun run build` resolves the aliases in the production output (inspect bundle for unresolved alias references).
  7. Add a negative test: use a non-existent alias path and verify the typecheck catches it.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/alias-resolution.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/index.ts` (exports for testing)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/desktop/src/index.ts` (alias imports)
- Acceptance:
  - All alias resolution tests pass in Vitest.
  - Aliases resolve identically in typecheck, dev, and build contexts.
  - Non-existent aliases produce clear compiler errors.
- Parallel: Yes (after T008/T009/T010 scripts are functional).

### Subtask T012 - Build infrastructure tests

- Purpose: Add automated tests that validate the build infrastructure itself, catching regressions in scripts, configs, and workspace resolution.
- Steps:
  1. Create a test file at `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/build-infra.test.ts`.
  2. Test: verify `bun install` succeeds by checking that workspace package `node_modules` links exist.
  3. Test: verify `tsconfig.base.json` has strict mode enabled by reading and parsing the config.
  4. Test: verify that each workspace `tsconfig.json` extends the base config.
  5. Test: verify that root `package.json` declares both workspace paths.
  6. Test: verify that `bunfig.toml` exists and contains required settings.
  7. Test: verify no circular workspace dependencies by analyzing package.json dependency graphs.
  8. Test: verify no `@ts-ignore`, `@ts-expect-error`, or lint suppression directives exist in any TypeScript source file (recursive scan).
  9. Ensure all tests are runnable via `bun test` or `bun run test`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/unit/build-infra.test.ts`
- Acceptance:
  - All build infrastructure tests pass.
  - Tests catch config regressions (e.g., removing strict mode).
  - Tests detect suppression directives if introduced.
- Parallel: Yes (after T008/T009/T010 scripts are functional).

### Subtask T013 - NFR performance validation

- Purpose: Measure and validate that the build infrastructure meets the non-functional requirements for speed and efficiency.
- Steps:
  1. Measure `bun install` time on a clean checkout (no `node_modules`) and verify < 30 seconds with warm registry cache.
  2. Measure `bun dev` cold start time from invocation to interactive desktop shell and verify < 5 seconds.
  3. Measure `bun run typecheck` time across the full monorepo and verify < 15 seconds.
  4. Document all measurements with hardware specs and conditions.
  5. If any NFR is not met, identify the bottleneck and document mitigation options.
  6. Add timing instrumentation to scripts if needed for ongoing monitoring.
- Files:
  - No new files; measurements documented in PR description and/or plan.md updates.
- Acceptance:
  - All NFR targets are met or documented with mitigation plans.
  - Measurements are reproducible.
- Parallel: No.

## Test Strategy

- Vitest unit tests for alias resolution and build infrastructure validation.
- Manual or scripted validation for dev server hot-reload and build artifact launch.
- Timing measurements for NFR compliance.
- Negative tests for type errors and non-existent aliases.

## Risks & Mitigations

- Risk: ElectroBun prerelease packaging is unstable.
- Mitigation: Isolate ElectroBun-specific build steps; fall back to basic Bun bundle for validation.
- Risk: Hot-reload does not propagate cross-workspace changes.
- Mitigation: Use Bun's `--watch` flag with explicit include paths; fall back to full restart if needed.

## Review Guidance

- Confirm `bun dev` starts and hot-reloads without manual steps.
- Confirm `bun run build` produces a self-contained artifact.
- Confirm `bun run typecheck` is independent of build and catches all errors.
- Confirm path aliases work in all contexts (tsc, dev, build, runtime).
- Confirm NFR measurements are documented.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-02-27T11:19:14Z – wp02-agent – shell_pid=22412 – lane=doing – Assigned agent via workflow command
- 2026-02-27T11:22:39Z – wp02-agent – shell_pid=22412 – lane=for_review – Ready for review: build/dev/typecheck scripts, path aliases, alias resolution tests, build infra tests. All 17 tests pass, typecheck clean, build produces minified artifacts with sourcemaps.
- 2026-03-01T13:25:16Z – wp02-agent – shell_pid=22412 – lane=done – Merged to main
