//! Soft contract for CLI help / subcommand surface (`BENCH-006` / L15 API Surface).
//!
//! Locks `benchora --help` (clap long help) so documented subcommands stay
//! honest. Soft evidence only — no OpenAPI / HTTP; no org secrets.

use clap::CommandFactory;
use phenotype_xdd_lib::cli::Cli;

/// Subcommands the product documents as the public CLI API surface.
const EXPECTED_SUBCOMMANDS: &[&str] = &["run", "report", "baseline", "compare", "mutate", "list"];

/// @trace BENCH-006
#[test]
fn clap_long_help_lists_all_subcommands() {
    let help = Cli::command().render_long_help().to_string();
    for name in EXPECTED_SUBCOMMANDS {
        assert!(
            help.contains(name),
            "top-level long help must list subcommand `{name}`; got:\n{help}"
        );
    }
}

/// @trace BENCH-006
#[test]
fn clap_subcommand_registry_matches_documented_surface() {
    let cmd = Cli::command();
    let registered: Vec<&str> = cmd.get_subcommands().map(|s| s.get_name()).collect();

    for name in EXPECTED_SUBCOMMANDS {
        assert!(
            registered.iter().any(|n| n == name),
            "clap must register subcommand `{name}`; registered={registered:?}"
        );
    }

    // No silent extras — keep help / API_REFERENCE / rustdoc in lockstep.
    for name in &registered {
        assert!(
            EXPECTED_SUBCOMMANDS.contains(name),
            "unexpected subcommand `{name}` — update docs/API_REFERENCE.md + this contract"
        );
    }
}

/// @trace BENCH-006
#[test]
fn each_subcommand_long_help_is_nonempty() {
    let mut root = Cli::command();
    for name in EXPECTED_SUBCOMMANDS {
        let help = root
            .find_subcommand_mut(name)
            .unwrap_or_else(|| panic!("missing subcommand `{name}`"))
            .render_long_help()
            .to_string();
        assert!(
            !help.trim().is_empty(),
            "subcommand `{name}` long help must be non-empty"
        );
        // Usage line should mention the subcommand name.
        assert!(
            help.to_lowercase().contains(name),
            "subcommand `{name}` help should mention itself; got:\n{help}"
        );
    }
}
