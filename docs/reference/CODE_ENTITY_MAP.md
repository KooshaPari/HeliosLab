# Code Entity Map — heliosApp

## Forward Map (Code -> Requirements)

| Entity | Type | FRs |
|--------|------|-----|
| `apps/runtime/src/protocol/` | Bus protocol | FR-BUS-001..010 |
| `apps/runtime/src/types/` | ID and type definitions | FR-ID-001..009 |
| `apps/runtime/src/config/` | App settings | FR-CFG-001..010 |
| `apps/runtime/src/lanes/` | Lane orchestrator | FR-LAN-001..008 |
| `apps/runtime/src/pty/` | PTY lifecycle | FR-PTY-001..008 |
| `apps/runtime/src/sessions/` | Session and mux | FR-ZMX-001..008, FR-BND-001..008 |
| `apps/runtime/src/renderer/` | Renderer engine | FR-ENG-001..008 |
| `apps/runtime/src/providers/` | Provider adapters | FR-PVD-001..012 |
| `apps/runtime/src/audit/` | Audit logging | FR-AUD-001..011 |
| `apps/desktop/` | Desktop shell | FR-MVP-* |
| `apps/renderer/` | Terminal renderer | FR-MVP-*, FR-ENG-* |
| `.github/workflows/` | CI/CD pipelines | FR-CI-001..011, FR-REV-001..010 |

## Reverse Map (Requirements -> Code)

| FR Category | Code Entities |
|-------------|---------------|
| FR-BUS | `apps/runtime/src/protocol/bus.ts`, `apps/runtime/src/protocol/types.ts` |
| FR-ID | `apps/runtime/src/types/` |
| FR-CFG | `apps/runtime/src/config/` |
| FR-LAN | `apps/runtime/src/lanes/` |
| FR-PTY | `apps/runtime/src/pty/` |
| FR-ZMX, FR-BND | `apps/runtime/src/sessions/` |
| FR-ENG | `apps/runtime/src/renderer/` |
| FR-PVD | `apps/runtime/src/providers/` |
| FR-AUD | `apps/runtime/src/audit/` |
| FR-SHR | (not yet implemented) |
| FR-CI, FR-REV | `.github/workflows/` |
| FR-DEP, FR-RUN | `package.json`, `apps/runtime/` |
| FR-MVP | `apps/desktop/`, `apps/renderer/`, `apps/runtime/` |
