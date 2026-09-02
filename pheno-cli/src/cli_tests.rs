// SPDX-License-Identifier: MIT OR Apache-2.0
//
// Copyright (c) 2026 Koosha Pari

use super::*;
use clap::Parser;

#[test]
fn cli_parses_with_clap_ext_flattens() {
    let cli = Cli::try_parse_from(["phenoctl", "--quiet", "--config", "/tmp/x.yml", "status"])
        .expect("parse");
    assert!(cli.verbosity.quiet);
    assert_eq!(
        cli.config.config.as_deref(),
        Some(std::path::Path::new("/tmp/x.yml"))
    );
}

#[test]
fn cli_parses_default_verbosity() {
    let cli = Cli::try_parse_from(["phenoctl", "status"]).expect("parse");
    assert_eq!(cli.verbosity.verbose, 0);
    assert!(!cli.verbosity.quiet);
}

#[test]
fn version_bump_parses_with_repo_root_override() {
    let cli = Cli::try_parse_from([
        "phenoctl",
        "--repo",
        "/tmp/worktree",
        "version",
        "bump",
        "helioslab",
        "1.2.3",
    ])
    .expect("version bump should parse");

    assert_eq!(
        cli.repo.as_deref(),
        Some(std::path::Path::new("/tmp/worktree"))
    );
    match cli.command {
        Commands::Version {
            cmd: VersionCmd::Bump { name, version },
        } => {
            assert_eq!(name, "helioslab");
            assert_eq!(version, "1.2.3");
        }
        _ => panic!("expected version bump command"),
    }
}

#[test]
fn version_sync_parses_with_repo_root_override() {
    let cli = Cli::try_parse_from([
        "phenoctl",
        "--repo",
        "/tmp/worktree",
        "version",
        "sync",
        "helioslab",
        "2.0.0",
    ])
    .expect("version sync should parse");

    assert_eq!(
        cli.repo.as_deref(),
        Some(std::path::Path::new("/tmp/worktree"))
    );
    match cli.command {
        Commands::Version {
            cmd: VersionCmd::Sync { name, upstream },
        } => {
            assert_eq!(name, "helioslab");
            assert_eq!(upstream, "2.0.0");
        }
        _ => panic!("expected version sync command"),
    }
}
