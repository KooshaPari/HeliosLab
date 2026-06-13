# SSOT — Single Source of Truth (HeliosLab)

This document records the canonical authority for cross-cutting facts in the
HeliosLab repository. When a fact conflicts across docs, the source listed
here wins.

## Scope

| Domain | Authoritative source |
| --- | --- |
| Build & test commands | `package.json` scripts (with `justfile` as mirror) |
| Release & versioning | `cliff.toml` + `CHANGELOG.md` (git-cliff generated) |
| Security disclosure process | `SECURITY.md` |
| Dependency updates | `.github/dependabot.yml` |
| Branch & commit policy | `.github/workflows/governance.yml` |
| Repository health score | `.github/workflows/scorecard.yml` (OpenSSF) |
| Editor / formatting baseline | `.editorconfig` |
| Architecture boundaries | `ARCHITECTURE.md` (see ADR.md for decisions) |
| Agent operating model | `AGENTS.md` |

## Precedence order

1. Executable config (scripts, workflows, build files) — observed behavior.
2. `*.md` governance files in this SSOT table.
3. `ADR.md` decisions and their superseding ADRs.
4. Anything else.

## Updating this file

- Keep the table narrow and unambiguous.
- Cite the canonical file by path; do not duplicate content.
- Update via a `chore(governance):` commit referencing the change.
