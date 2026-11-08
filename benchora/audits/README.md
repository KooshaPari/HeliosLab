# Benchora — Audits

This directory holds the canonical audit-trail artifacts for the
Benchora benchmarking harness. It is a placeholder of last resort: any
measurement-grade claim (bench scores, oracle deltas, golden-corpus
hashes, model-family conformance) MUST land here before it is
referenced in docs/, SSOT.md, or external benchmarks.

## Sub-directories

| Sub-directory | Purpose | Notes |
|---|---|---|
| `org-audit-snapshots/` | Point-in-time captures of Benchora + fleet inventory used in audits | append-only; never overwrite |
| `postmortems/` | Blameless retrospectives of failed benchmarks, oracle divergences, or infra incidents | one file per event, dated |
| `ci-exceptions/` | One-off CI waivers (e.g. NIAH oracle skipped due to known environment drift) | each waiver expires; link to owner + ticket |
| `boundary-reconciliation/` | Reconciliations with phenoregistry `BOUNDARY_OWNERS.md` (which repo owns benchmarking?) | match by YYYY-MM-DD |
| `absorption-justifications/` | When a benchmark, dataset, or contract is absorbed from another repo, this directory records why | one file per absorbed artifact |

## Conventions

- File names: `YYYY-MM-DD-<slug>.md` (UTC, slug = kebab-case).
- Each artifact opens with a one-paragraph summary, then a table of
  contents, then the full report. Keep tone neutral; this is
  audit-grade prose.
- Append only. If a report is superseded, write a new dated file that
  links to its predecessor and adds a `Supersedes: <path>` header.
- Sensitive secrets must be redacted; see phenotype-registry
  `audits/secret-handling-policy.md` (if present) before committing.

## Cross-references

- Backlog: `BACKLOG-CROSSREPO-001` (closes 1 of 12 cross-repo gaps
  cataloged by `_cockpit/XREPO_BACKLOG.json`)
- Parent context: `/Users/<REDACTED>/CodeProjects/Phenotype/repos/_cockpit/audit-Benchora.json`
