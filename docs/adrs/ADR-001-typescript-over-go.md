# ADR-001: TypeScript + Bun as Primary Language for heliosApp

## Status

Proposed (requires 3 approvals per constitution L116-118)

## Context

The heliosApp constitution (`docs/reference/constitution.md`) states: "Prefer Go where feasible for core systems." This ADR documents a permanent exception to that rule for the heliosApp repository.

heliosApp is a desktop control-plane application built on **ElectroBun**, an Electron alternative that is TypeScript-native. The project forks from **co(lab)**, an existing TypeScript codebase. The desktop shell, renderer integration (ghostty/rio), and UI surface all require deep JavaScript/TypeScript interop at every integration boundary.

Using Go as the primary language would require FFI bridges for every desktop integration point -- ElectroBun APIs, renderer lifecycle management, IPC with the shell process, DOM/UI event handling, and plugin extensibility. This would add substantial complexity, maintenance burden, and performance overhead with no architectural benefit for a desktop control-plane application.

The constitution already recognizes TypeScript (TS7 Native) and Bun as valid choices (L19, L21). This ADR formalizes TypeScript + Bun as the **primary** language for heliosApp rather than a secondary fallback.

## Decision

Use TypeScript with the Bun runtime as the primary language and execution environment for heliosApp. Go, Rust, and Zig remain available for performance-critical subsystems (e.g., terminal multiplexer integration, session checkpoint I/O) where native code provides a measurable benefit, but TypeScript is the default.

## Consequences

**Positive:**
- Zero impedance mismatch with ElectroBun's TypeScript-native APIs
- Direct code reuse from the co(lab) fork base without language translation
- Single runtime (Bun) for build, test, and execution toolchain
- Aligns with constitution's existing Bun ecosystem preference (L21)

**Negative:**
- Diverges from the "Prefer Go" default, which may cause confusion for contributors expecting Go
- TypeScript's runtime performance ceiling is lower than Go for compute-heavy paths (mitigated by using native code for those specific paths)

**Neutral:**
- Testing stack (Vitest + Playwright) is already TypeScript-native per constitution L25
- This decision does not affect other Phenotype repositories; the Go preference remains the default elsewhere

## Sunset

N/A -- This is a permanent architectural decision for the heliosApp repository. The ElectroBun desktop shell is fundamentally TypeScript-native, making this a structural constraint rather than a temporary exception.
