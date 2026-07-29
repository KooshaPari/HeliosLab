---
work_package_id: WP06
title: Hardening, Performance Gates, and Release Readiness
lane: "done"
dependencies:
- WP04
base_branch: 001-colab-agent-terminal-control-plane-WP05
base_commit: f1d0bc01693c809a121c904e94a68cf81422b4a2
created_at: '2026-02-26T16:35:12.454108+00:00'
subtasks:
- T026
- T027
- T028
- T029
- T030
phase: Phase 4 - Hardening and release
assignee: ''
agent: ''
shell_pid: "65388"
review_status: "approved"
reviewed_by: "Koosha Paridehpour"
history:
- timestamp: '2026-02-26T13:19:35Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP06 - Hardening, Performance Gates, and Release Readiness

## Objectives & Success Criteria

- Enforce strict quality and security gates required by constitution and feature NFRs.
- Add runtime performance instrumentation and soak validation for multi-session workflows.
- Finalize quickstart and MVP boundary documentation for implementation handoff.

Success criteria:
- Quality gates pass with no ignores/skips.
- Performance metrics are emitted and reviewed under soak runs.
- Docs reflect real validated commands and deferred scope boundaries.

## Context & Constraints

Reference docs:
- `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/quickstart.md`
- `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/plan.md`
- `docs/reference/constitution.md`

Constraints:
- Device-first performance expectations with bounded resource use.
- Strict analysis/test/security posture.
- Keep explicit distinction between MVP and deferred post-MVP work.

Implementation command:
- `spec-kitty implement WP06 --base WP05`

## Subtasks & Detailed Guidance

### Subtask T026 - Implement runtime performance metrics
- Purpose: provide measurable insight for lane/session/terminal health.
- Steps:
  1. Add metrics for lane create latency, session restore latency, output backlog depth.
  2. Emit metrics in lightweight structured format.
  3. Integrate metrics with diagnostics surface where applicable.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/src/`

### Subtask T027 - Add soak/performance harness scenarios
- Purpose: validate behavior under sustained multi-session usage.
- Steps:
  1. Add scripts/tests for repeated lane/session churn and terminal load.
  2. Capture trend metrics and establish baseline thresholds.
  3. Document failure criteria and triage notes.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/apps/runtime/tests/`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/docs/` (if baseline notes are added)

### Subtask T028 - Enforce strict quality/security gates
- Purpose: guarantee constitution-level gate strictness.
- Steps:
  1. Configure lint, type, static analysis, and security checks to strict mode.
  2. Ensure CI/local command paths fail on violations.
  3. Remove any bypass or ignore patterns discovered in this feature scope.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/` (tooling config files in scope)

### Subtask T029 - Validate quickstart and ops flows end-to-end
- Purpose: ensure documentation matches working behavior.
- Steps:
  1. Execute quickstart scenarios A/B/C and capture adjustments.
  2. Update quickstart with exact validated commands and expected outputs.
  3. Confirm fallback and diagnostics guidance are explicit.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/quickstart.md`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/plan.md` (only if alignment updates needed)
- Parallel: Yes.

### Subtask T030 - Publish MVP boundary checklist
- Purpose: avoid scope confusion during implementation/review.
- Steps:
  1. Document included MVP capabilities and deferred post-MVP durability expansion.
  2. Cross-check against spec FRs and success criteria.
  3. Add release-readiness checklist to feature docs.
- Files:
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/tasks.md`
  - `/Users/kooshapari/CodeProjects/Phenotype/repos/heliosApp/kitty-specs/001-colab-agent-terminal-control-plane/quickstart.md`
- Parallel: Yes.

## Test Strategy

- Run enforced WP06 runtime gates: `bun run lint`, `bun run typecheck`, `bun run static`,
  `bun run test`, `bun run security`, `bun run quality`.
- Run soak profile and capture metrics snapshots.
- Re-run fallback and recovery scenarios after hardening.

## Risks & Mitigations

- Risk: hardening exposes latent failures late.
- Mitigation: stage checks early and keep per-WP gate runs incremental.
- Risk: soak harness introduces flaky thresholds.
- Mitigation: keep strict thresholds, but allow a narrow near-threshold retry band for session-restore
  host jitter before failing closed.

## Review Guidance

- Verify strict gates are actually enforced, not only documented.
- Verify metric outputs are actionable and mapped to success criteria.
- Verify deferred scope boundaries are explicit and not ambiguous.

## Activity Log

- 2026-02-26T13:19:35Z – system – lane=planned – Prompt created.
- 2026-02-26T16:53:10Z – unknown – shell_pid=65388 – lane=for_review – Ready for review (forced lane move): hardening/perf gates/release readiness implemented in worktree commit 03dcbaa.
- 2026-02-27T07:48:13Z – unknown – shell_pid=65388 – lane=for_review – Restacked, quality gate passing; ready for review.
- 2026-03-01T13:23:00Z – unknown – shell_pid=65388 – lane=done – Merged to main
