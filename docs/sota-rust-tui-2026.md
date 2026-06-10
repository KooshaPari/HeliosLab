# SOTA: Rust TUI Libraries (2026)

State-of-the-art survey of terminal UI libraries for Rust, with recommendations
for the HeliosLab / Phenotype monorepo. Survey date: 2026-06-10.

## TL;DR

For new Rust TUI work in 2026, **use [Ratatui](https://ratatui.rs/)**
(current `0.30.x` line). It is the de-facto industry standard, powers tools at
Netflix, OpenAI, Vercel, AWS, Hugging Face, GitButler, and Electronic Arts
(21k+ stars, 31M+ crates.io downloads, 4,200+ dependent crates). For the
HeliosLab `phenoctl` operator UI this matches what we already ship — see
`pheno-cli/src/tui.rs`.

## Ratatui (recommended)

- **Crate:** `ratatui` (https://crates.io/crates/ratatui)
- **Latest:** `0.30.1` (June 2026 line). The `0.30.0` release reorganized the
  crate into a modular workspace: `ratatui-core`, `ratatui-widgets`,
  `ratatui-crossterm`, `ratatui-termion`, `ratatui-termwiz`, `ratatui-macros`.
  Application authors should keep depending on the umbrella `ratatui` crate.
- **Backend model:** pluggable. Defaults to **Crossterm** (Linux/macOS/Windows)
  with optional **Termion** and **Termwiz** backends.
- **Rendering:** **immediate mode** — the app re-renders a full `Frame` every
  tick, Ratatui diffs against a back-buffer and writes only the delta to the
  TTY. This gives predictable layout and works cleanly with `no_std` /
  embedded targets.
- **DX:** new `ratatui::run()` convenience wrapper, builder widgets
  (`Block::bordered()`), `Stylize` short-hand, `Layout::vertical([...])` /
  `Layout::horizontal([...])` arrays, 100% documented, Discord + Matrix +
  Discourse forum.
- **Ecosystem:** charts, sparklines, tables, gauges, calendars, scrollable
  lists, `tui-textarea`, `ratatui-image`, `color-eyre` integration, etc.

## tui-rs (legacy / do not use)

`tui-rs` was the original Rust TUI library. It was abandoned by its
maintainer in early 2023 and was forked into **Ratatui** by `@fdehau` and
the Ratatui team. New projects should depend on `ratatui` directly. The
old `tui` crate is unmaintained, has known security advisories on the
buffer-double-free path, and is not receiving fixes.

## Cursive (viable alternative)

- **Crate:** `cursive` (https://crates.io/crates/cursive)
- **Latest:** `0.21.1`. ~4.8k stars. MIT-licensed. Still maintained, but the
  release cadence is much slower than Ratatui's.
- **Backend model:** Crossterm by default; also supports Termion, Pancurses,
  BearLibTerminal, plus a `dummy` backend for tests.
- **Rendering:** **retained mode, callback-driven.** You build a tree of
  `View`s, attach callbacks on events, and Cursive dispatches input for you.
  This is closer to a desktop UI toolkit (think Tk / immediate-mode GUI)
  than to Ratatui's redraw-every-frame model.
- **When Cursive wins:** small, form-heavy apps (dialogs, menus, settings
  screens) where a retained tree and built-in focus management save you from
  re-implementing tab/enter/escape handling. Solid Linux-TTY support,
  including `cursive-flexi-logger-view` and `cursive-tabs` extensions.
- **When Cursive loses:** dashboards, log viewers, large scrollable tables,
  and any UI that needs tight control over frame timing — Ratatui's
  immediate-mode model composes more naturally there.

## Recommendation for HeliosLab

`pheno-cli/src/tui.rs` already uses `ratatui` `0.29` + `crossterm` `0.28`
(see `pheno-cli/Cargo.toml:17-18`). That is the correct 2026 choice. The
operator surface (`phenoctl tui`) is a four-tab dashboard over the
`.phenotype/config.db` (Config / Flags / Secrets / Versions), which fits
Ratatui's `Tabs` + `List` + `Paragraph` widget set perfectly and renders
in well under one frame budget on commodity terminals.

The only migration we should consider in the near term is bumping to the
`0.30.x` line so we can adopt the new `ratatui::run()` / `ratatui::init()`
helpers and the modular workspace split, which trims compile time on
`pheno-cli` and unblocks the `ratatui-widgets` reuse path for future
shared widgets in the Phenotype monorepo.

## References

- Ratatui website: https://ratatui.rs/
- Ratatui repo: https://github.com/ratatui/ratatui
- Cursive repo: https://github.com/gyscos/cursive
- Cursive docs: https://docs.rs/cursive/latest/cursive/
- In-repo: `pheno-cli/src/tui.rs`, `pheno-cli/Cargo.toml:11-21`
