# Known Issues and Risks

## Open Issues

- KI-1: Incomplete canonical source certainty for "Claude Squad" naming and ownership.
- KI-2: "Google Antigravity" references are directional; implementation-relevant docs are still ambiguous.
- KI-3: ACP naming is used in multiple contexts; interoperability standards are not universally fixed across vendors.

## Technical Risks

- TR-1: Provider CLI behavior drift can break adapters unexpectedly.
- TR-2: 25-terminal concurrency may exceed memory budget without strict buffering policies.
- TR-3: Terminal renderer choice may create OS-specific regressions.
- TR-4: Mux integration edge cases (reattach state, nested shells, signal handling).

## Product Risks

- PR-1: Scope creep toward full GUI IDE can dilute core terminal advantage.
- PR-2: User trust loss if command explainability and rollback are weak.
- PR-3: Security posture may be insufficient for enterprise pilot without stronger policy defaults.

## Mitigations

- Define provider conformance tests per adapter.
- Add soak and fault-injection tests early.
- Enforce strict scope guardrails in milestone planning.
- Default to conservative approval mode until confidence metrics are met.

## Release Closure Risks

- RC-1: Cleared locally on 2026-03-12 via Gate 1 policy, approval, and redaction reruns.
- RC-2: Cleared locally on 2026-03-12 via Gate 2 recovery and audit replay validation.
- RC-3: Cleared locally on 2026-03-12 via Gate 3 provider conformance and isolation reruns.
- RC-4: Cleared locally on 2026-03-12 via Gate 4 startup, soak, benchmark, and renderer-switch reliability reruns; a separate reference-hardware replay is still advisable before external launch signoff.
