# heliosApp Project Overview

## Purpose

Part of the co(lab) toolchain modernization (WP03). The heliosApp is a hybrid browser + code editor for deep work, built with Bun runtime and task automation.

## Tech Stack

- **Runtime**: Bun (package manager and runtime)
- **Build Tool**: Electrobun (custom build tool)
- **Task Runner**: go-task (Taskfile.yml)
- **Language**: TypeScript
- **Code Quality**: Biome (linting & formatting)
- **Testing**: Vitest
- **Bundler**: esbuild
- **UI Framework**: Solid.js
- **Editor**: Monaco Editor
- **Terminal**: xterm

## Code Style & Conventions

- Uses Biome for formatting and linting (see biome.json)
- TypeScript for type safety
- Follows task-based workflow with Taskfile.yml
- Uses bunx for executing CLI tools
- macOS-focused CI/CD with code signing

## Important Commands

See suggested_commands.md

## CI/CD Workflow

- GitHub Actions: build-release.yml
- Builds on macOS 15 (Apple Silicon)
- Uses Bun for package management
- Publishes demo plugin to npm on stable releases
- Currently uses Node.js setup for npm publishing, npm version, and npm publish commands
- NEEDS UPDATE: Should migrate from npm commands to bunx npm and add go-task installation

## Project Structure

- `/src` - Main source code
- `/scripts` - Build and setup scripts
- `/test-plugin` - Demo plugin for publishing to npm
- `/docs` - Documentation
- `/llama-cli` - Llama CLI integration with cached dependencies
- `/vendors` - Vendor directories (Zig compiler, etc.)
- `.github/workflows/` - GitHub Actions workflows
- `Taskfile.yml` - Task definitions using go-task
