# Contributing to heliosApp

Thank you for your interest in contributing! This repository is part of the [Phenotype](https://github.com/KooshaPari) ecosystem.

## Prerequisites

- Node.js (LTS) and the package manager declared in `package.json` (pnpm/bun/npm).
- Git and a GitHub account with access to push branches.

## Development Workflow

1. **Spec first.** All non-trivial work must be tracked in [AgilePlus](https://github.com/KooshaPari/AgilePlus). Check for an existing spec under `kitty-specs/` before implementing; otherwise create one with `agileplus specify --title "<feature>"`.
2. **Branch.** Cut feature branches from `main` using the form `<category>/<short-slug>` (e.g. `feat/auth-rotation`, `fix/null-deref`).
3. **Implement.** Follow the existing module layout. Match prevailing code style — do not reformat unrelated files.
4. **Test.** Run the project's test script (typically `pnpm test` or `bun test`).
5. **Quality gates.** Run the project's lint and typecheck scripts (typically `pnpm lint` and `pnpm typecheck`).
6. **Commit.** Use conventional-commit style (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Keep commits scoped — one logical change per commit.
7. **Pull request.** Open a PR against `main`. Reference the AgilePlus spec ID in the description. Fill the PR template if present.

## Code Review

- All PRs require at least one approving review.
- CI must pass on Linux runners (macOS/Windows runners may be skipped due to org billing constraints).
- Do not introduce new lint suppressions without inline justification.

## Reporting Issues

- **Bugs and feature requests:** open a GitHub issue with reproduction steps or motivation.
- **Security vulnerabilities:** see [`SECURITY.md`](./SECURITY.md) — do **not** file public issues for security reports.

## License

By contributing you agree that your contributions will be licensed under this repository's license (see `LICENSE`).
