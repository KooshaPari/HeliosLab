# SOTA: Rust CLI Best Practices in 2026

> **Status**: Living document. Research snapshot: 2026-06-09.
> **Scope**: Crate selection for the next generation of Phenotype CLI tooling,
> with direct reference to the in-tree `pheno-cli` binary (`phenoctl`).

---

## Executive Summary

The 2026 Rust CLI ecosystem is mature and largely converged. A small set of
well-maintained crates covers ≥90% of user-facing CLI surface area: argument
parsing, progress reporting, interactive prompts, and diagnostic error output.
The recommended stack for new HeliosLab/Phenotype CLI work is:

| Concern        | Recommended crate  | Version | Why                                                         |
| -------------- | ------------------ | ------- | ----------------------------------------------------------- |
| Arg parsing    | `clap`             | 4.6.x   | Derive macros, help, completions, rich error formatter.     |
| Progress UX    | `indicatif`        | 0.18.x  | Bounded bars, spinners, templates, `HumanBytes`.           |
| Interactive IO | `dialoguer`        | 0.12.x  | Confirm, password, select, fuzzy-select, multi-select.     |
| Diagnostics    | `miette`           | 7.6.x   | Snippets, labels, error codes, links, screen-reader mode.  |
| Logging        | `tracing` + `tracing-subscriber` | 0.1 / 0.3 | Structured, level-filtered, span-aware logging.   |
| TUI            | `ratatui` + `crossterm` | 0.29 / 0.28 | Battle-tested terminal UI in `pheno-cli/src/tui.rs`.  |

---

## 1. Argument parsing: `clap` vs `argh` vs `lexopt`

### `clap` 4.6.x (recommended default)
- **Current version**: 4.6.1 (per docs.rs).
- **MSRV**: 1.74, supports the last two minor Rust releases.
- **Strengths**: derive macros, builder API, value parsers, `--help`, shell
  completions (`clap_complete`), man-page generation (`clap_mangen`), i18n
  (`clap-i18n-richformatter`), response files (`argfile`), and the
  RichFormatter that suggests fixes on parse errors.
- **Drawbacks**: heavier binary size and longer compile time than minimalist
  alternatives; the `derive` feature pulls in `clap_derive`.
- **When to use**: any non-trivial CLI with subcommands, validation, or
  auto-generated help. The de-facto standard in the Rust ecosystem.

### `argh` 0.1.19
- **Current version**: 0.1.19 (per docs.rs).
- **Origin**: Google Fuchsia. Conforms to the Fuchsia commandline tools spec.
- **Strengths**: derive-based, optimized for **code size**, fast compile
  times, predictable help format, dynamic subcommand support.
- **Drawbacks**: smaller feature surface (no `clap_complete` equivalent, no
  built-in shell completions, less flexible value parsing).
- **When to use**: small, embedded, or `no_std`-adjacent CLIs where every
  kilobyte of binary size matters.

### `lexopt` 0.3.2
- **Current version**: 0.3.2 (per docs.rs).
- **Strengths**: deliberately minimal, single-file, iterator-style parser.
  Zero derive macros, zero codegen, minimal dependencies.
- **Drawbacks**: you write the parsing loop yourself. No help generation, no
  validation beyond your own `match` arms.
- **When to use**: tiny utilities (1–3 flags), or when you want full control
  over the parsing semantics.

### Verdict
For `phenoctl` and similar Phenotype CLIs, **clap with `derive` is the right
choice**. `pheno-cli/Cargo.toml:15` already declares
`clap = { version = "4", features = ["derive"] }` and `pheno-cli/src/main.rs:9`
uses `#[derive(Parser)]` and `#[derive(Subcommand)]` (lines 9–58). Switching
to `argh` or `lexopt` would cost us auto-generated `--help`, subcommand
discovery, value parsers, and shell completions for negligible compile-time
savings. Reach for `argh` only if binary size becomes a hard constraint;
reach for `lexopt` only for ≤2-flag utilities.

---

## 2. Progress reporting: `indicatif` 0.18.x

- **Current version**: 0.18.4 (per docs.rs).
- **Capabilities**: `ProgressBar` (bounded bars), unbounded spinners
  (`new_spinner` + `enable_steady_tick`), `MultiProgress` for parallel
  workers, `ProgressIterator` for one-liner integration, optional Rayon
  support (`features = ["rayon"]`).
- **Template system**: `{elapsed_precise} {bar:40.cyan/blue} {pos:>7}/{len:7} {msg}`-style
  placeholders; color via `console`.
- **Human formatting**: `HumanBytes`, `BinaryBytes`, `DecimalBytes`,
  `HumanDuration`, `HumanCount`, `HumanFloatCount` — drop-in wrappers for
  user-facing byte/time/count strings.
- **TTY-aware**: bars are silently hidden when stderr is not a terminal, so
  logs and pipes stay clean.
- **Recommendation**: add `indicatif` to `pheno-cli` to wrap the secret
  encryption in `pheno-cli/src/main.rs:323-332` (where the user is prompted
  for a password and a key is loaded from the environment) — these are the
  long-running operations users will want feedback on. Also wrap bulk
  operations in any future `phenoctl flags audit` or `phenoctl migrate`
  commands.

---

## 3. Interactive prompts: `dialoguer` 0.12.x

- **Current version**: 0.12.0 (per docs.rs).
- **Capabilities**: `Confirm`, `Input<T>`, `Password`, `Select<T>`,
  `MultiSelect<T>`, `FuzzySelect<T>`, `Sort<T>`, `Editor` (behind features).
- **Ecosystem**: from the `console-rs` org alongside `indicatif` and
  `console`, so the three share styling primitives and TTY detection.
- **Recommendation**: replace `rpassword` (currently the only prompt
  dependency in `pheno-cli/Cargo.toml:20`) with `dialoguer::Password` to
  consolidate the prompt surface area and gain TTY detection for free. The
  call site at `pheno-cli/src/main.rs:323`
  (`rpassword::prompt_password("Enter secret value: ")`) is a one-line swap.
  When we add interactive flows (e.g. multi-select for which flags to
  retire, fuzzy-select for which secret to delete), `dialoguer` is the
  obvious choice.

---

## 4. Diagnostics: `miette` 7.6.x

- **Current version**: 7.6.0 (per docs.rs).
- **MSRV**: 1.70.
- **Capabilities**: a generic `Diagnostic` protocol with
  - error codes (`code(my_app::my_error)`) rendered as clickable links in
    supporting terminals,
  - `url(docsrs)` shorthand that auto-links to docs.rs,
  - source-code snippets with `#[label(...)]` and `#[label(primary, ...)]`
    annotations,
  - `help` text (attribute or field),
  - `severity` (`Error` / `Warning`),
  - `#[related]` aggregation of multiple errors into one report,
  - `fancy` feature flag for ANSI-colored graphical output, with a
    narratable (screen-reader) handler that activates automatically under
    `NO_COLOR=1` and on CI,
  - `IntoDiagnostic` + `Report` + `miette!`/`bail!`/`ensure!` macros that
    match the `anyhow`/`eyre` ergonomics.
- **Recommendation**: introduce `miette` as the error type for the `phenoctl`
  binary, not for the library crates. Per the `miette` docs: *"Use this
  `Result` type (or its expanded version) as the return type throughout your
  app (but NOT your libraries! Those should always return concrete types!)."*
  Library crates (`pheno-core`, `pheno-db`, `pheno-crypto`) should keep
  returning concrete `thiserror`-derived types; `pheno-cli` is the right
  layer to wrap them in `miette::Report` for pretty printing. The current
  `pheno-cli/src/main.rs:130-136, 152-155, 211-217, 256-260, 263-266, 313-320,
  421-426` all use `eprintln!` + `std::process::exit(1)`. A `miette`-based
  refactor would (a) produce one-line `Result<()>` returns, (b) include
  error codes that link to docs, and (c) integrate with `tracing` so the
  same error renders in logs and on stderr.

---

## 5. Cross-cutting concerns

- **Logging**: keep `tracing` + `tracing-subscriber` (already in
  `pheno-cli/Cargo.toml:21`). Add `tracing-miette` to layer miette's
  graphical output over `tracing_error::SpanTrace`. Add
  `clap-verbosity-flag` to wire up `-v`/`-vv`/`-vvv` to the subscriber's
  `EnvFilter`.
- **Config**: `figment` or `config` for layered config (file + env + flags);
  `directories` to discover XDG paths.
- **Shell completions**: `clap_complete` is a one-line addition that gives
  us bash/zsh/fish/PowerShell completions for free.
- **Man pages**: `clap_mangen` for roff source → system man pages.
- **Distribution**: `cargo dist` (built on `cargo-build` + `cargo-packager`)
  is the 2026 default for cross-platform binaries; ditto for Homebrew taps
  and `cargo binstall` support.
- **Testing**: `assert_cmd` + `assert_fs` + `predicates` for CLI integration
  tests; `trycmd` / `snapbox` for snapshot tests of `--help` and command
  output.

---

## 6. Action items for `pheno-cli`

1. **Keep** `clap = { version = "4", features = ["derive"] }` — the right
   choice for a multi-subcommand, multi-flag binary.
2. **Add** `indicatif = "0.18"` and wrap any future bulk operations in a
   `ProgressBar` (e.g. mass `flags audit`).
3. **Swap** `rpassword` for `dialoguer = { version = "0.12", features = ["password"] }`
   to consolidate prompt UX.
4. **Add** `miette = { version = "7", features = ["fancy"] }` and refactor
   the 8+ `eprintln!` / `process::exit(1)` call sites in
   `pheno-cli/src/main.rs` to return `miette::Result<()>` from `main`.
5. **Add** `clap_complete` and `clap-verbosity-flag` for completions and
   standard `-v` handling.
6. **Add** `assert_cmd` dev-dependency for end-to-end CLI testing of the
   subcommand surface.

The existing `pheno-cli` already uses the canonical TUI pair
(`ratatui` + `crossterm`) and the canonical logger (`tracing-subscriber`),
so the rest of the stack is in good shape — the gaps are `indicatif`,
`dialoguer`, `miette`, and shell-completion support.

---

## References

- clap 4.6.1 docs — <https://docs.rs/clap/4.6.1/clap/>
- argh 0.1.19 docs — <https://docs.rs/argh/0.1.19/argh/>
- lexopt 0.3.2 docs — <https://docs.rs/lexopt/0.3.2/lexopt/>
- indicatif 0.18.4 docs — <https://docs.rs/indicatif/0.18.4/indicatif/>
- dialoguer 0.12.0 docs — <https://docs.rs/dialoguer/0.12.0/dialoguer/>
- miette 7.6.0 docs — <https://docs.rs/miette/7.6.0/miette/>
- *Command Line Applications in Rust* — <https://rust-cli.github.io/book/>
- *pheno-cli source* — `pheno-cli/src/main.rs`, `pheno-cli/src/tui.rs`,
  `pheno-cli/Cargo.toml`
