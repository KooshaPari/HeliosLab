# Changelog

All notable changes to this project will be documented in this file.

## 📚 Documentation
- Docs(readme): expand README.md with purpose, stack, quick-start, related projects (`c548127`)
- Docs: add README/SPEC/PLAN (`e190b1a`)
- Docs(spec): add real spec docs (PRD, FR, ADR) from codebase analysis (#45)

Replaces stub spec docs with content derived from Rust source analysis.
Migrated from blackboardsh/colab #14.

Co-authored-by: Phenotype Agent <agent@phenotype.dev>
Co-authored-by: Claude Sonnet 4.6 <noreply@anthropic.com> (`a0d5679`)
## 🔨 Other
- Chore(ci): adopt phenotype-tooling workflows (wave-2) (`aad48a2`)
- Test(smoke): seed minimal smoke test (wave-2) (`abe6c64`)
- Chore(governance): adopt standard CLAUDE.md + AGENTS.md + worklog (`5da83f2`)
- Chore: add AgilePlus scaffolding (`a50e56a`)
- Ci(legacy-enforcement): add legacy tooling anti-pattern gate (WARN mode)

Adds legacy-tooling-gate.yml monitoring per CLAUDE.md Technology Adoption Philosophy.

Refs: phenotype/repos/tooling/legacy-enforcement/ (`d9433ce`)