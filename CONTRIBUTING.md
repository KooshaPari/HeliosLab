# Contributing

Thanks for your interest in contributing. This document covers local setup,
the quality bar, and how to get a change merged.

## Prerequisites

Detected stack: **polyglot**.

See the project README for toolchain versions. Install the declared linters,
formatters, and type checkers. Do not bypass them.

## Development Workflow

1. Fork or branch from `main`: `git checkout -b <prefix>/<topic>`.
2. Keep commits focused. Use conventional commit prefixes (`feat`, `fix`, `chore`,
   `docs`, `refactor`, `test`).
3. Open a PR against `main` with a clear summary and test plan.

## Quality Gate (Stack-Aware)

Run the appropriate local gate before pushing:

This repository contains multiple language sub-projects. Run the quality gate
inside each language directory (e.g. \`rust/\`, \`go/\`, \`python/\`):

\`\`\`bash
# Rust
(cd rust && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
# Go
(cd go && gofmt -l . && go vet ./... && go test ./...)
# Python
(cd python && ruff check . && ruff format --check . && pytest)
\`\`\`

## Suppression Policy

Do not blanket-ignore lint or type errors. Any suppression must name the rule,
justify why it cannot be fixed, and link a follow-up ticket.

## Security

See [SECURITY.md](./SECURITY.md) for private vulnerability reporting.

## License

By contributing, you agree your contributions are licensed under the repository's
declared license.
