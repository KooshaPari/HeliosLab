# Contributing to Co(lab)

Start with **[README.md](README.md)** for project overview, features, installation, and development commands.

## Repository norms

- **[AGENTS.md](AGENTS.md)** — rules for AI-assisted work in this repo (paths, encoding, workflows).
- **[CLAUDE.md](CLAUDE.md)** — additional Claude-specific guidance where present.

## Package manager

This repository uses **[Bun](https://bun.sh)** (`bun.lock` at the root). Install and run scripts with:

```bash
bun install
bun run dev
```

Use **`bun`** for dependency installs and script execution unless a nested package documents otherwise. Do not commit alternate lockfiles (for example **pnpm**-specific trees) unless a maintainer explicitly adds them as part of a documented change.

## Working directory

Run installs, builds, and documented scripts from the **repository root** unless instructions point to a subdirectory (for example documentation or plugin folders).

## Local scratch

Do **not** commit scratch files, caches, or experiments under **`.tmp/`**. That path is ignored; keep ephemeral work there or outside the repo.

## Pull requests

- Keep changes focused and consistent with existing style and tooling.
- Follow the test and format commands in `package.json` / README before opening a PR.
