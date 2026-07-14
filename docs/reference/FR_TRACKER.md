# FR Implementation Tracker — heliosApp

Comprehensive FR list is in `FUNCTIONAL_REQUIREMENTS.md`. This tracker covers implementation status by category.

| Category | FR Count | Status | Code Location |
|----------|----------|--------|---------------|
| FR-BUS (Local Bus) | 10 | Implemented | `apps/runtime/src/protocol/` |
| FR-ID (ID Standards) | 9 | Implemented | `apps/runtime/src/types/` |
| FR-CFG (App Settings) | 10 | Implemented | `apps/runtime/src/config/` |
| FR-LAN (Lane Orchestrator) | 8 | Implemented | `apps/runtime/src/lanes/` |
| FR-PTY (PTY Lifecycle) | 8 | Implemented | `apps/runtime/src/pty/` |
| FR-ZMX (Zellij Mux) | 8 | Implemented | `apps/runtime/src/sessions/` |
| FR-BND (Terminal Binding) | 8 | Implemented | `apps/runtime/src/sessions/` |
| FR-ENG (Renderer Engine) | 8 | Implemented | `apps/runtime/src/renderer/` |
| FR-PVD (Provider Adapter) | 12 | Planned | `apps/runtime/src/providers/` |
| FR-AUD (Audit Logging) | 11 | Planned | `apps/runtime/src/audit/` |
| FR-SHR (Share Session) | 11 | Planned | — |
| FR-CI (CI/CD) | 11 | Implemented | `.github/workflows/` |
| FR-REV (Code Review) | 10 | Implemented | `.github/workflows/` |
| FR-DEP (Dependencies) | 8 | Implemented | `package.json`, `bun.lock` |
| FR-RUN (Runtime Setup) | 8 | Implemented | `apps/runtime/` |
| FR-MVP (Helios MVP) | 27 | In Progress | `apps/` |
