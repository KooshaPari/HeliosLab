//! Smoke tests verifying that clap-ext's Verbosity and ConfigArg work in this CLI.

use clap::Parser;
use clap_ext::prelude::*;

#[test]
fn clap_ext_verbosity_parses_quiet_flag() {
    #[derive(Parser)]
    struct Probe {
        #[command(flatten)]
        verbosity: Verbosity,
    }

    let probe = Probe::try_parse_from(["probe", "--quiet"]).expect("parse");
    assert_eq!(format!("{:?}", probe.verbosity.to_filter()), "LevelFilter::ERROR");
}

#[test]
fn clap_ext_verbosity_parses_double_v() {
    #[derive(Parser)]
    struct Probe {
        #[command(flatten)]
        verbosity: Verbosity,
    }

    let probe = Probe::try_parse_from(["probe", "-vv"]).expect("parse");
    assert_eq!(format!("{:?}", probe.verbosity.to_filter()), "LevelFilter::TRACE");
}

#[test]
fn clap_ext_config_arg_default_is_none() {
    #[derive(Parser)]
    struct Probe {
        #[command(flatten)]
        config: ConfigArg,
    }

    let probe = Probe::try_parse_from(["probe"]).expect("parse");
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
    assert_eq!(probe.config.config.unwrap().to_str().unwrap(), "/tmp/cfg.toml");
}
