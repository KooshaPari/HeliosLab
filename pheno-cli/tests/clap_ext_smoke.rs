//! Smoke tests verifying that clap-ext's Verbosity and ConfigArg work in this CLI.
// FR: CLI argument parsing supports verbosity and config options.

use clap::Parser;
use clap_ext::prelude::*;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tracing_subscriber::filter::LevelFilter;

fn phenotype_config_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[test]
fn clap_ext_verbosity_parses_quiet_flag() {
    #[derive(Parser)]
    struct Probe {
        #[command(flatten)]
        verbosity: Verbosity,
    }

    let probe = Probe::try_parse_from(["probe", "--quiet"]).expect("parse");
    assert_eq!(probe.verbosity.to_filter(), LevelFilter::ERROR);
}

#[test]
fn clap_ext_verbosity_parses_double_v() {
    #[derive(Parser)]
    struct Probe {
        #[command(flatten)]
        verbosity: Verbosity,
    }

    let probe = Probe::try_parse_from(["probe", "-vv"]).expect("parse");
    assert_eq!(probe.verbosity.to_filter(), LevelFilter::TRACE);
}

#[test]
fn clap_ext_config_arg_default_is_none() {
    #[derive(Parser)]
    struct Probe {
        #[command(flatten)]
        config: ConfigArg,
    }

    let _guard = phenotype_config_lock().lock().expect("lock config environment");
    let previous = std::env::var_os("PHENOTYPE_CONFIG");
    std::env::remove_var("PHENOTYPE_CONFIG");
    let probe = Probe::try_parse_from(["probe"]).expect("parse");
    match previous {
        Some(value) => std::env::set_var("PHENOTYPE_CONFIG", value),
        None => std::env::remove_var("PHENOTYPE_CONFIG"),
    }
    assert!(probe.config.config.is_none());
}

#[test]
fn clap_ext_config_arg_parses_short_flag() {
    #[derive(Parser)]
    struct Probe {
        #[command(flatten)]
        config: ConfigArg,
    }

    let probe = Probe::try_parse_from(["probe", "-c", "/tmp/cfg.toml"]).expect("parse");
    assert_eq!(probe.config.config.as_deref(), Some(Path::new("/tmp/cfg.toml")));
}
