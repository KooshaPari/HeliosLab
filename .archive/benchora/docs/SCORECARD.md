# SCORECARD / WORK_DAG — Benchora

Rescored: [`audit_scorecard.json`](../audit_scorecard.json) — **overall 85, grade B**
(`BENCH-007`, 2026-07-23). Prior baseline: **82 / B** (2026-06-24, auditor v2).

Evidence-only lifts after T1–T5 merges (#79–#83). No invented jumps — bump only
where soft docs/CI/contract evidence clearly supports a score increase or a
maturity **2→3** band cross (≈75+). Prefer soft gates before org-secret work.

## Rescore delta (`BENCH-007`)

| Pillar | Before | After | Evidence | Band |
|--------|-------:|------:|----------|------|
| L8 Compliance | 30 | 55 | Root `SSOT.md` + `ARCHITECTURE.md` + soft `docs-canonical` (#79) | 1→2 (process still soft) |
| L4 Observability | 65 | 80 | Canonical docs **6/8→8/8** (#79) | **2→3** |
| L20 Config | 50 | 65 | SPEC/SSOT env table + `config_env_contract_test` (#80) | stays 2 |
| L27 Infrastructure | 75 | 85 | Multi-stage `Dockerfile` + soft `docker-smoke` (#81) | already 3; +10 |
| L29 Monitoring | 70 | 80 | Exit codes + `benchora.report.v1` contract (#82); no Prometheus | **2→3** soft |
| L15 API Surface | 50 | 65 | `--help` subcommand contract + rustdoc / API_REFERENCE (#83); no OpenAPI | stays 2 |

**Overall:** 82 → **85** (mean pillar delta applied to prior overall; grade remains B).

## Current grade breakdown (lowest first)

| Pillar | Score | Gap theme | Secrets? |
|--------|------:|-----------|----------|
| L17 I18n/A11y | 45 | N/A-ish for Rust CLI; low ROI | No |
| L19 Memory | 45 | Python-biased auditor; Rust RAII already | No |
| L24 Migration | 50 | Deprecation / migrate notes thin | No |
| L8 Compliance | 55 | SSOT present; process evidence still soft | No |
| L26 Event Driven | 55 | Not a queue product; optional adapter docs | No |
| L28 Cost Efficiency | 55 | Batching/pagination N/A for bench CLI | No |
| L15 API Surface | 65 | CLI help locked; no OpenAPI (CLI-only) | No |
| L20 Config | 65 | Env/clap documented + contract; thin beyond that | No |
| L14 Data Layer | 70 | SQLite present; migration story soft | No |
| L16 Frontend | 70 | Docs site only | No |
| L13 Logging | 75 | Structured logging sparse | No |
| L4 Observability | 80 | Canonical docs 8/8 | No |
| L3 Agent Loop | 80 | CLI exists; help contract green | No |
| L29 Monitoring | 80 | Exit/schema soft health only | No |
| L27 Infrastructure | 85 | Dockerfile + soft smoke; no compose/k8s | No |

High pillars (skip for lift): L5/L9/L25 = 100; L1/L10 = 95; L2/L11/L12/L23/L30 ≥ 90.

## READY gaps — next (no org secrets)

1. **L8 Compliance** — deepen process evidence beyond SSOT index (still soft).
2. **L15 / L20** — optional further contracts; skip OpenAPI unless HTTP lands.
3. **L13 Logging** — structured tracing only if product needs it.
4. Deferred / low ROI: L17, L19 (auditor mismatch), L26/L28 (not core to Criterion CLI).

## WORK_DAG — T1–T5 complete; T6 rescore

```text
[DONE]    T1 docs+CI  ARCHITECTURE.md + SSOT.md + docs-canonical soft gate (#79)
              │
              ▼
[DONE]    T2 config   Expand SPEC/SSOT config section + clap env contract (#80)
              │
              ▼
[DONE]    T3 infra    Minimal Dockerfile + `make docker-smoke` (#81)
              │
              ├──► [DONE] T4 monitor  Exit-code / report-schema soft evidence (#82)
              │
              └──► [DONE] T5 api      --help subcommand contract + rustdoc (#83)
                          │
                          ▼
[DONE/PR] T6 rescore  Evidence-based SCORECARD + audit_scorecard.json (BENCH-007)
```

| ID | Task | Pillars | Est. lift | Blockers |
|----|------|---------|-----------|----------|
| T1 | Canonical SSOT + ARCHITECTURE + soft docs CI | L8, L4 | High | Done (#79) |
| T2 | Config surface tests + SPEC env table sync | L20, L8 | Med | Done (#80) |
| T3 | Dockerfile + local smoke target | L27, L30 | Med | Done (#81) |
| T4 | Monitoring soft evidence (exit codes / schema) | L29, L4 | Med | Done (#82) |
| T5 | CLI `--help` contract + rustdoc / API_REFERENCE | L15, L3 | Med | Done (#83) |
| T6 | Governance re-score from T1–T5 evidence | L8/L4/L20/L27/L29/L15 | Docs | None (this PR) |

## Lane claim rule

Claim **one** READY task per PR on `feat/benchora-audit-lift-N` (or
`feat/benchora-audit-rescore-*` for scorecard-only). Do not merge from scout
agents unless explicitly asked. Update this DAG when a lane lands.
