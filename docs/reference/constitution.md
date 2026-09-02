# heliosApp Constitution

> Created: 2026-02-26
> Updated: 2026-02-27
> Version: 2.0.0

## Purpose

This constitution captures the technical standards, code quality expectations,
tribal knowledge, and governance rules for heliosApp — a terminal-first desktop
IDE built on an ElectroBun fork of co(lab). All features and pull requests
should align with these principles.

## Technical Standards

### Languages and Frameworks
- **Primary language**: TypeScript (TS7-native) on Bun runtime.
  - This is a desktop app built on ElectroBun (TypeScript-native). Go is not feasible for the core system. See `docs/adrs/ADR-001-typescript-over-go.md`.
- **Supporting languages** (where appropriate):
  - Rust, Zig: Performance-critical native modules, renderer integration, system-level bindings.
  - Python: CPython 3.14 preferred, PyPy 3.11 acceptable — for tooling and automation scripts only.
- **Desktop shell**: ElectroBun (forked from co(lab) by Blackboard).
- **Terminal renderers**: ghostty (primary) + rio (secondary, feature-flagged).
- **Mux/orchestration**: zellij (session multiplexing), par (lane-based worktree execution), zmx (checkpoint/restore).
- **Collaboration**: upterm + tmate (share-session workflows, post-MVP).
- **Protocol stack**: Internal local bus (`helios.localbus.v1`) + ACP + MCP + A2A for agent interop.
- Reuse proven patterns and artifacts from related repos (for example `../thegent`, `../trace`) where applicable.

### Testing Requirements
- Primary testing stack: Vitest + Playwright (Jest is not the preferred framework).
- Coverage target: 85-95% minimum, with continuous optimization toward 100% where feasible.
- Rust code should maintain near-full coverage.
- Full test pyramid is required (unit, integration, e2e) with broad validation depth.
- Include advanced quality validation as part of testing strategy:
  - Static and active analyzers.
  - Performance regression tests (including linear-regression-style trend tracking).
  - Security testing.
  - Chaos/resilience testing.
  - Requirements traceability checks.
- Assume minimal direct human feedback; validation depth must compensate.

### Performance and Scale
- Device-first runtime model; cloud deployment is not the default target.
- Cloud usage, if any, is limited to user-owned/personal infrastructure (VPS, Supabase, personal remote machine).
- User concurrency is secondary; primary target is tab/session/agent concurrency.
- Target operating envelope: approximately 300-1000 concurrent tabs/sessions on an 8 GB RAM, 4-core CPU device.
- Terminal rendering SLOs:
  - Input-to-echo latency: p50 < 30ms, p95 < 60ms.
  - Input-to-render latency: p50 < 60ms, p95 < 150ms.
  - Renderer frame stability: 60 FPS target on active pane.
  - Startup to interactive: < 2 seconds.
  - Memory: < 500 MB steady-state for typical workload (25 active terminals).

### Deployment and Constraints
- Dockerless by default.
- Preferred execution modes:
  - `proc-compose` local process orchestration.
  - Native execution.
  - Low-overhead/high-performance container or sandbox systems when needed.
- Deployment/runtime choices must prioritize low overhead and high local efficiency.

## Code Quality

### Pull Request Requirements
- Every PR must be reviewed by another agent.
- Automated review gates (GCA and CodeRabbit) are required and count as approval gates.
- If review tooling is rate-limited, re-review must be requested before merge.
- Self-merge is allowed after all required gates pass.

### Code Review Checklist
Reviewers must validate at minimum:
- Correctness, clarity, and maintainability.
- Tests added/updated appropriately.
- Documentation and docstrings updated where needed.
- Type quality and robust error handling.
- Performance implications (especially terminal hot path).
- Security risks.
- Anti-pattern detection and remediation.
- Preference for well-vetted libraries over unnecessary hand-rolled implementations.
- Avoidance of excessive backward-compatibility/fallback code paths.
- Regression risks across versions and code paths.

### Quality Gates
- All defined gates must pass at maximum strictness.
- No ignores, skips, or excludes for required quality checks.

### Documentation Standards
- Full-spectrum documentation is required:
  - Public API docs/docstrings with examples where applicable.
  - ADRs for architectural choices and exceptions.
  - Debug/investigation notes.
  - Research documents.
  - Feature plans.
  - Retrospectives.
  - End-to-end operational documentation.
- Documentation quality is subject to governance review.

## Tribal Knowledge

### Team Conventions
- Reuse established conventions from related repos where they remain applicable.
- File size targets:
  - Preferred: 150-350 lines.
  - Hard limit: 500 lines.
- Design for generic, scalable, extensible, and modular shared code from day one.
- Follow Hexagonal architecture and SOLID/KISS/DRY/Clean principles.
- Practice TDD/BDD/SDD as standard engineering workflow patterns.
- **Control plane / data plane separation**: Keep PTY byte path off UI thread. Terminal rendering is the hot path; orchestration is async.
- **Bounded buffers and explicit backpressure**: No unbounded arrays or memory runaway in terminal output paths.
- **Graceful degradation**: External failures (tool/A2A/harness) isolate to lane-level, never crash global runtime.

### Lessons Learned
- Apply lessons learned from related prior repos by default.
- Prefer `bun` and `uv` over `npm` and `pip` where the toolchain allows.
- Carry forward broad best practices already validated in adjacent projects.
- **Fork before build**: When starting from an existing app (co(lab)), fork and strip first — don't rewrite from scratch. Prove the product thesis (keystroke → PTY → render → screen) before formalizing protocol compliance.

### Historical Decisions
- Historical architectural decisions should be sourced from prior repos and used as guiding precedent.
- See `docs/adrs/` for project-specific architectural decision records.

## Governance

### Amendment Process
- Constitution amendments require 2-3 agent review loops before acceptance.

### Compliance Validation
- Agents and code reviewers validate constitution compliance and block merge when violated.

### Exception Handling
- Exceptions must be documented in an ADR.
- Exceptions require 3 approvals.
- Each exception must include a defined sunset date (or explicit justification for permanence).
