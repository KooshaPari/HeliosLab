# Research Decision Log

## Summary

- **Feature**: `001-colab-agent-terminal-control-plane`
- **Date**: 2026-02-26
- **Researchers**: codex
- **Open Questions**: None blocking Phase 1

## Decisions & Rationale

| Decision | Rationale | Evidence | Status |
|----------|-----------|----------|--------|
| Use a tight vertical slice first (not full adapter matrix) | Fastest path to prove value and validate control-plane UX with lower integration risk | User alignment during planning interrogation; `docs/sessions/20260226-helios-market-research/12_FORK_STRATEGY.md` | final |
| Canonical provider path is Codex CLI + `cliproxyapi++` harness | Explicit user requirement for first-class flow and harness validation | User planning input; `docs/sessions/20260226-helios-market-research/13_CROSS_REPO_ROLLOUT_MAP.md` | final |
| Degrade to native OpenAI login when harness unavailable | Keeps runtime usable under integration failure while preserving operability | User planning input; NFR graceful degradation in `kitty-specs/001-colab-agent-terminal-control-plane/spec.md` | final |
| Use in-memory session state for slice-1 continuity via Codex session IDs | Reduces initial complexity while preserving a continuity mechanism for early adoption | User planning input; state/event model in `docs/sessions/20260226-helios-market-research/07_PROTOCOL_AND_EVENTS.md` | final |
| Maintain deterministic bus envelope and lifecycle events as hard architectural invariant | Core control-plane reliability depends on correlation and ordered state transitions | `specs/protocol/v1/envelope.schema.json`; `docs/sessions/20260226-helios-market-research/07_PROTOCOL_AND_EVENTS.md` | final |
| Keep Bun + TS-native toolchain with strict test gates | Matches constitution and existing repo direction (`apps/runtime`, `apps/desktop`) | `docs/reference/constitution.md`; repository layout under `apps/` | final |
| Maintain formal protocol parity between `specs/protocol/v1` and feature contracts | Prevents drift from initial architecture intent while allowing explicit phased defer/extension handling | `specs/protocol/v1/methods.json`, `specs/protocol/v1/topics.json`, `contracts/orchestration-envelope.schema.json` | final |

## Evidence Highlights

- **Local-first architecture is already established**: existing runtime protocol modules in `apps/runtime/src/protocol/` support command/event boundaries.
- **Control-plane protocol baseline exists**: `specs/protocol/v1/envelope.schema.json`, `specs/protocol/v1/methods.json`, and `specs/protocol/v1/topics.json` are available for contract extension.
- **Risk area to manage explicitly**: scope tension between long-term durability expectations and slice-1 in-memory continuity must stay visible in planning and tasks.
- **Protocol parity snapshot**: formal baseline has 24 methods and 22 topics; feature overlay now tracks full formal surface with explicit extension/defer policy and parity tasks (WP07-WP09).

## Next Actions

1. Implement contract set for lane/session/terminal lifecycle and harness health/degradation semantics.
2. Build data model and quickstart scenarios around canonical Codex CLI + `cliproxyapi++` path.
3. Generate tasks with explicit follow-up work for durable checkpoint/restore after slice-1.
4. Keep parity-check gate active to detect method/topic drift as contracts evolve.

## WP09 Formal Parity Policy

- Canonical formal surface remains `specs/protocol/v1/methods.json` and `specs/protocol/v1/topics.json`.
- Feature coverage trace is required in `contracts/protocol-parity-matrix.json` for every formal method/topic.
- Defer decisions are valid only with `status: deferred` and `task_ids` containing one or more `Txxx` entries.
- Extension decisions are valid only when explicitly marked `status: extension` and represented in contract/runtime assets.

Verification commands:

```bash
node tools/gates/protocol-parity.mjs
bun test apps/runtime/tests/unit/protocol/protocol_parity_gate.test.ts
```
