# HeliosLab Audit — 2026-10-17

## IDENTITY
HeliosLab is a TypeScript + Bun + Rust monorepo "lab" for Phenotype infrastructure experiments: an Electrobun desktop shell, a Rust `phenoctl` CLI with TUI, Go/Python FFI bridges, and a Python benchmark harness (`helios-bench`). Repo ID `1167587447`, default branch `main`.

## INTENT
Per canonical DOSSIER/AGENT-PROMPT: "workbench/configuration composite with contract reconciliation." Per README: hybrid browser+code-editor desktop shell, multi-architecture CLI, domain-agnostic benchmarking — a proving ground before subsystems graduate to dedicated repositories. Identity must be adjudicated against `HeliosCLI / HeliosLite / KCode / PhenoShared` (one name must not mask unrelated implementation).

## CURRENT STATE
HEAD `d9abb874` (2026-10-03, "fix(workspace): createWorkspace rejects every native Windows absolute path"). Working tree has 7 uncommitted edits (GitHub Actions workflows, `bun.lock`, `package.json`, `tools/typecheck-owned.ts`) plus 3 untracked files (`tsconfig.tests.json`, `tools/typecheck-owned.test.ts`, `docs/dossiers/`) — active in-flight work. Canonical STATE.md sampled `863830bc5` (2026-09-16), so the local tree has advanced ~17 days past the canonical snapshot without a refresh.

## CODE REALITY
- 768 TypeScript source files + 12 Rust source files + 299 test files (not zero — scorecard is stale).
- Real implementation lives in `apps/desktop/` (Electrobun shell + tabs: chat, agent, project, session, terminal, persistence, context_switch, keyboard_shortcuts), `apps/runtime/` (policy, providers, sessions, workspace, recovery, durability_wiring, redaction), `packages/` (errors, ids, logger, runtime-core, persistence, pty-pool, device-manager, orchestrator, inference).
- Rust sidecar: `pheno-cli/src/main.rs` (507 LoC, real clap parser for `phenoctl`), `pheno-core/src/lib.rs` (625 LoC), `pheno-cli/src/tui.rs` (188 LoC); FFI bridges `crates/pheno-ffi-python/src/lib.rs` (335 LoC, PyO3) and `crates/pheno-ffi-go/src/lib.rs` (256 LoC, cgo) — all non-trivial.
- Real evidence of test execution in `packages/VERIFICATION_STATUS.md` (2026-09-17): Go SSH integration suite `5/5 pass` against the operator's real Tailscale MacBook (`kooshas-laptop`); 14/14 orchestrator + 53/53 device-manager + 3/3 TS FFI + clean `go vet`/`tsc --strict`/`gofmt`.
- Stub signature: `src/renderers/helioslab/index.ts` is **effectively empty** — single comment `// HeliosLab renderer — minimal entry, RPC stubs populated by main process` then `export {};`. The named-product renderer does not render.

## STUB/MOCK/MVP-LAZINESS INVENTORY
- `src/renderers/helioslab/index.ts:1-2` — empty renderer stub for the product's own UI (the `bunny` and `ivde` renderers carry the load).
- `src/main/plugins/pluginManager.ts` — ~10 `// TODO: implement` lines at 719, 735, 748, 776, 785, 926, 933, 940, 944, 950, 954; one `// TODO: Add worker isolation in v2` at 573.
- `src/main/utils/analytics.ts:30,36,41,384` — "Replace with actual auth check", "Check user subscription status", "Check team subscription status", "Update all call sites" — cloud-side analytics is mocked out.
- `src/renderers/bunny/` — only 4 files (the smallest renderer, likely a sketch).
- `audit_scorecard.json` is **stale and misleading**: overall `54 / D+`, but reports `L1 Architecture: 0 (No source files found)`, `L2 Dev Loop: 10 (0 test files)`, `L3 Agent Loop: 40 (CLI: MISSING)`, `L7 Extensibility: 25 (0 source files)` — contradicted by the actual 768/12/299 counts above. Scorecard scanner is reading an empty/wrong root path.
- `worklog.md` redirects to `AgilePlus` whose path is `<REDACTED>` — current real work state is invisible from this repo alone.
- 128 total `TODO/FIXME/MOCK/STUB/placeholder` markers across 20+ TS files (concentrated in `pluginManager.ts` and `analytics.ts`); zero hits in any Rust file.
- `tools/typecheck-owned.ts` (uncommitted, in working tree) introduces a typed-ratchet gate restricted to `OWNED_PREFIXES` and explicitly acknowledges that a prior `tsc --noEmit` exited 0 on 2026-10-15 while the FFI bridge shipped with errors — i.e. an in-progress fix for a known silent-regression bug.

## FWD PATH TO FINISH
1. Fix or delete `audit_scorecard.json` — regenerate against the current repo root so future audits read true (or remove the L1/L2/L7 false-zero readings).
2. Implement `src/renderers/helioslab/` or remove the empty stub and route `views://helioslab/index.html` to a real renderer (`bunny`/`ivde`).
3. Resolve the `pluginManager.ts` TODOs (worker isolation v2, UI notifications, missing event handlers) — the file already has 10 unimplemented branches; either ship them or remove the dead menu items.
4. Publish the AgilePlus worklog path or inline the current work-package list so this repo is self-describing for downstream audits.
5. Adjudicate identity boundary vs `HeliosCLI/HeliosLite/KCode/PhenoShared` (canonical DOSSIER §3) — pick the canonical name and prune the rest to one implementation.

## TIME-TO-FINISH ESTIMATE
4–8 working days for a single owner chat: ~1 day scorecard + renderer, ~2 days `pluginManager` TODOs + analytics stub removal, ~1 day AgilePlus unblock, ~1 day identity boundary write-up + ADR, plus 1–3 days buffer for test repair and CI green. Less if "finish" means "ship the subset that already passes tests" (≈1–2 days); more if full MVP-laziness removal is required.

## SUNSET/KEEP CALL
**KEEP.** Real code, real tests, real verified evidence (live SSH integration against the operator's machine), an active commit stream with current work in progress. The scorecard's D+ is a measurement artifact, not a product verdict. Sunsetting would discard substantive verified work; the only honest move is to repair the audit artifacts and ship the named renderer.

## CONFIDENCE
**High.** Findings rest on direct file/line observations (768/12/299 counts, `pluginManager.ts` line numbers, empty `helioslab/index.ts` body, scorecard contradiction with filesystem). The lone soft spot is TIME-TO-FINISH — estimates are bounded by the in-flight 7 uncommitted edits and 3 untracked files whose contents were not fully audited.

## AUDIT TRAIL
- Clone used: `/Users/kooshapari/CodeProjects/Phenotype/repos/HeliosLab` (HEAD `d9abb874`, 2026-10-03); the alternate `_full_HeliosLab` clone is stale at `3c3e639` (2026-09-12) and was not the audit basis.
- Canonical sources read: `AGENT-PROMPT.md` (1.3 federation + 1.4 capability/proof amendments), `STATE.md` (sampled `863830bc5` 2026-09-16, "SCOPE_CHANGE_REQUIRES_QUALIFICATION"), `DOSSIER.md` (8 sections, "no runtime grade or superiority claim").
- Repo-relative evidence: `audit_scorecard.json` (stale, contradicts filesystem), `packages/VERIFICATION_STATUS.md` (2026-09-17 honest self-assessment), `worklog.md` (AgilePlus redirect, REDACTED path), `apps/desktop/src/index.ts`+`client.tsx`+`tabs/`, `apps/runtime/src/{policy,sessions,workspace,recovery,durability_wiring,redaction}/`, `pheno-cli/src/{main.rs,tui.rs,cli_tests.rs}`, `crates/pheno-ffi-{python,go}/src/lib.rs`.
- Cross-references: identity boundary to `HeliosCLI / HeliosLite / KCode / PhenoShared` is the same adjudication thread flagged in DOSSIER §3 and AGENT-PROMPT "Ecosystem obligation"; audit did NOT inspect any of those sibling repos.
- Time budget: ~3 minutes wallclock (read 3 canonical sources + 6 targeted Bash inventories + 1 sample TODO grep). Read-only: zero modifications to HeliosLab source.
- Output artifact: `/Users/kooshapari/.jcode/scratch/master-audit-2026-10-17/audits/helioslab.md` (50 lines, written 2026-10-17, owner-chat `session_rabbit_1792023467050_5be12ef1045add15`).
