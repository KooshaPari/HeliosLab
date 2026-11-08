//! Benchora binary entry point.
//!
//! Thin wrapper that parses CLI args and dispatches to the `cli::run`
//! handler. Keeping the binary this thin lets the core logic stay in
//! `lib.rs` for reuse as a library.

use clap::Parser;

use phenotype_xdd_lib::cli::{run, Cli};

fn main() {
    let cli = Cli::parse();
    if let Err(e) = run(cli) {
        // Display uses the `thiserror` impl in cli/error.rs.
        // Exit contract (`BENCH-005` / L29): Ok → 0, any CliError → 1.
        // No Prometheus / `--health` HTTP surface; CI monitors via exit codes
        // and `benchora.report.v1` JSON (see SPEC/SSOT).
        eprintln!("benchora: {e}");
        std::process::exit(1);
    }
}
