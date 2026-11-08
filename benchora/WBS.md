# WBS — Benchora (2026-08-09)

**Repo:** Benchora
**Status:** initial skeleton; expand as scope grows.
**Owner:** forge (agent CLI). **Driver:** `proc` / `proc <id>`.

## Phase overview

| Phase | Tasks | Theme | Outcome |
|-------|-------|-------|---------|
| 0 | 1–5 | audit close-out + inventory | reproducible baseline |
| 1 | 6–15 | docstring coverage gate | ≥80% public-API docstring |
| 2 | 16–25 | test coverage expansion | ≥70% line coverage |
| 3 | 26–35 | CI hardening (ruff + mypy + bandit) | 0 lint/type/security findings |
| 4 | 36–50 | release hygiene (CHANGELOG, tags, .github) | tagged releases |
| 5 | 51–60 | cross-repo fleet sync (RepoLedger hooks) | auto-tracked |
| 6 | 61–70 | docs site (mkdocs or docusaurus) | public docs URL |
| 7 | 71–80 | integrate & ship | `benchora-v0.x` tag |

---

## Phase 0 — Audit (tasks 1–5)

| ID | Title | depends_on | ac |
|----|-------|------------|----|
| 1 | inventory modules in `benchora/` | — | ac_v1 |
| 2 | scan remaining mypy errors | 1 | ac_v1 |
| 3 | scan bandit MEDIUM findings | 1 | ac_v1 |
| 4 | scan F841 unused-name findings | 1 | ac_v1 |
| 5 | tag current HEAD as `benchora-v0.x` baseline | 1–4 | ac_v1 |

---

## Ac conventions

- `ac_v1`: commit on `main` with conventional subject + DAG id in footer.
- `ac_test`: `pytest -q tests/` exits 0.
- `ac_cron`: `launchctl kickstart -k` fires, sidecar written.

---

## Notes

- Part of the **Phenotype Fleet** (cross-repo audit at
  `pheno-harness/_cockpit/XREPO_BACKLOG.json`).
- AMC / Agentora remains paused per `pheno-harness/AGENTS.md §3.2`.
- Branch taxonomy: 8-prefix (feat/, fix/, chore/, docs/, test/, refactor/,
  perf/, build/).
