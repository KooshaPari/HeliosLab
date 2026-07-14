---
work_package_id: WP01
title: Registry Manifest and Status Command
lane: "done"
dependencies: []
base_branch: main
base_commit: 9552558a2d3333de47ddae58d65bd41ebc2b6f85
created_at: '2026-03-01T13:29:44.943436+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
phase: Phase 1 - Dependency Tracking
assignee: ''
agent: "claude-haiku"
shell_pid: "55021"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-27T00:00:00Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP01 - Registry Manifest and Status Command

## Objectives & Success Criteria

- Create a version-controlled registry manifest that tracks all prerelease dependencies with rich metadata.
- Deliver a `bun run deps:status` command for visibility into current pins, available upgrades, and staleness.
- Establish a structured changelog for all upgrade attempts.

Success criteria:
- The manifest contains entries for all tracked prerelease dependencies with complete metadata.
- `bun run deps:status` reports accurate current pins, latest versions, channels, and days since last update.
- The changelog schema supports recording pass/fail upgrade attempts with full context.
- All manifest and changelog operations are tested.

## Context & Constraints

- Constitution: `docs/reference/constitution.md`
- Plan: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/020-prerelease-dependency-registry/plan.md`
- Spec: `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/020-prerelease-dependency-registry/spec.md`

Constraints:
- Manifest must be version-controlled in the repo (NFR-004).
- Status command must complete in < 10 seconds with warm cache (NFR-002).
- Manifest changes must be committed atomically with lockfile changes.
- Keep files under repository limits (target <=350 lines, hard <=500).

Implementation command:
- `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 - Create deps-registry.json manifest schema

- Purpose: Define the structured format for tracking prerelease dependencies with all metadata needed for safe upgrade management.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/deps-registry.json` with a well-defined JSON schema.
  2. Each dependency entry must include: `name` (package identifier), `currentPin` (exact version string), `channel` (one of: `alpha`, `beta`, `rc`, `stable`), `upstreamSource` (registry URL or GitHub release URL), `knownGoodHistory` (array of `{version, timestamp, gateResult}` objects), and `lastUpdated` (ISO 8601 timestamp).
  3. Include a top-level `schemaVersion` field for future schema evolution.
  4. Include a `metadata` section with `lastStatusCheck` timestamp and `registryCacheMaxAge` duration.
  5. Validate the schema is parseable by standard JSON tools and TypeScript type-safe.
  6. Define a TypeScript interface in `scripts/deps-types.ts` matching the JSON schema for compile-time safety.
  7. Add JSDoc comments to all interface fields documenting their purpose and constraints.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/deps-registry.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-types.ts`
- Acceptance:
  - JSON schema is valid and parseable.
  - TypeScript interfaces match JSON structure exactly.
  - All fields documented with JSDoc.
- Parallel: No.

### Subtask T002 - Populate initial manifest entries

- Purpose: Seed the manifest with the project's known prerelease dependencies so the status command has real data to report from day one.
- Steps:
  1. Identify all prerelease dependencies currently used in the project: ElectroBun, ghostty, zellij, and any others referenced in `package.json` or `bunfig.toml`.
  2. For each dependency, determine: current pinned version, channel designation, upstream source URL (npm registry or GitHub releases API endpoint).
  3. Add each entry to `deps-registry.json` with an initial `knownGoodHistory` containing the current pin as the first known-good version.
  4. Set `lastUpdated` to the current timestamp.
  5. Verify the populated manifest parses correctly using the TypeScript interface from T001.
  6. Commit the manifest alongside the lockfile to establish the initial tracking baseline.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/deps-registry.json`
- Acceptance:
  - All known prerelease dependencies have manifest entries.
  - Each entry has a complete and accurate set of fields.
  - The manifest is valid JSON parseable by the TypeScript types.
- Parallel: No.

### Subtask T003 - Implement deps:status command

- Purpose: Give developers and CI a single command to see the health of all tracked prerelease dependencies.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-status.ts`.
  2. Read and parse `deps-registry.json` using the TypeScript interfaces from T001.
  3. For each tracked dependency, query the upstream source for the latest available version:
     - For npm packages: use `npm view <package> versions --json` or Bun's equivalent.
     - For GitHub releases: use the GitHub Releases API (`GET /repos/{owner}/{repo}/releases`).
  4. Implement a local response cache (file-based or in-memory) to avoid hitting rate limits. Cache TTL should be configurable via `metadata.registryCacheMaxAge` in the manifest.
  5. Calculate `daysSinceLastUpdate` for each dependency based on `lastUpdated`.
  6. Format output as a table with columns: Package, Current Pin, Latest Available, Channel, Days Since Update, Status (up-to-date/upgrade-available/stale).
  7. Add `--json` flag for structured JSON output suitable for CI consumption.
  8. Exit 0 if all dependencies are up-to-date; exit 1 if any have available upgrades; exit 2 on registry errors.
  9. Add the `deps:status` script entry to root `package.json`.
  10. Handle edge cases: registry unreachable (warn and use cached data), dependency channel disappeared (alert), malformed manifest entry (error with specific field).
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-status.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/package.json` (script entry)
- Acceptance:
  - `bun run deps:status` produces a readable table of all tracked dependencies.
  - `--json` flag produces structured JSON output.
  - Completes in < 10 seconds with warm cache.
  - Graceful degradation on registry failures.
- Parallel: No.

### Subtask T004 - Create changelog schema and append utility

- Purpose: Establish a structured, append-only log of all dependency upgrade attempts for auditability.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/deps-changelog.json` with an initial empty array.
  2. Define the changelog entry schema in `scripts/deps-types.ts`: `timestamp` (ISO 8601), `package` (name), `fromVersion`, `toVersion`, `channel`, `gateResults` (object with per-gate pass/fail), `outcome` (success/failure/rollback), `actor` (user/ci/canary), `branchRef` (optional, for canary runs).
  3. Implement an `appendChangelogEntry` function in a shared utility (`scripts/deps-changelog-util.ts`) that:
     - Reads the current changelog.
     - Validates the new entry against the schema.
     - Appends the entry.
     - Writes the file atomically (write to temp, rename).
  4. Ensure the utility is importable by both the rollback and canary scripts (WP02).
  5. Add the changelog file to version control alongside the manifest.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/deps-changelog.json`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-types.ts` (changelog entry interface)
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/deps-changelog-util.ts`
- Acceptance:
  - Changelog entries are appended atomically.
  - Schema validation prevents malformed entries.
  - The utility is reusable by rollback and canary scripts.
- Parallel: No.

### Subtask T005 - Add unit tests for manifest, status, and changelog

- Purpose: Lock the behavior of the manifest parser, status reporter, and changelog utility with deterministic tests.
- Steps:
  1. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-manifest.test.ts`:
     - Test: valid manifest parses without errors.
     - Test: manifest with missing required fields throws with specific field name.
     - Test: manifest with invalid channel value throws.
     - Test: known-good history is ordered chronologically.
  2. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-status.test.ts`:
     - Test: status command produces correct table output for known fixture data.
     - Test: `--json` flag produces valid JSON matching expected schema.
     - Test: registry cache is used when available and fresh.
     - Test: stale cache triggers re-fetch.
     - Test: unreachable registry falls back to cached data with warning.
  3. Create `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-changelog.test.ts`:
     - Test: valid entry appends successfully.
     - Test: invalid entry (missing field) is rejected.
     - Test: concurrent appends produce consistent results (no data loss).
     - Test: atomic write prevents partial file corruption.
  4. Ensure all tests run via `bun test scripts/tests/`.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-manifest.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-status.test.ts`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/scripts/tests/deps-changelog.test.ts`
- Acceptance:
  - All tests pass.
  - Tests cover positive, negative, and edge cases.
  - Tests are deterministic (no flakiness).
- Parallel: Yes (after T003 and T004 interfaces are stable).

## Test Strategy

- Vitest unit tests for manifest parsing, status reporting, and changelog operations.
- Fixture-based tests with known-good and malformed data.
- Cache behavior tests with mocked registry responses.
- Deterministic, no flakiness.

## Risks & Mitigations

- Risk: Upstream registry API changes break status queries.
- Mitigation: Abstract registry access behind an adapter interface; mock in tests.
- Risk: Manifest schema needs to evolve.
- Mitigation: `schemaVersion` field enables forward-compatible evolution.

## Review Guidance

- Confirm all manifest fields are documented and type-safe.
- Confirm status command handles registry failures gracefully.
- Confirm changelog writes are atomic and validated.
- Confirm no suppression directives in any source file.

## Activity Log

- 2026-02-27T00:00:00Z – system – lane=planned – Prompt created.
- 2026-03-01T13:29:45Z – claude-haiku – shell_pid=55021 – lane=doing – Assigned agent via workflow command
- 2026-03-01T13:31:39Z – claude-haiku – shell_pid=55021 – lane=done – Implemented
