mod tui;

use chrono::Utc;
use clap::{Parser, Subcommand};
use pheno_core::*;
use pheno_db::Database;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "phenoctl", about = "Phenotype configuration manager")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Path to the repo root (default: current directory)
    #[arg(long, global = true)]
    repo: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Commands {
    /// Manage feature flags
    Flags {
        #[command(subcommand)]
        cmd: FlagCmd,
    },
    /// Manage config entries
    Config {
        #[command(subcommand)]
        cmd: ConfigCmd,
    },
    /// Manage encrypted secrets
    Secrets {
        #[command(subcommand)]
        cmd: SecretCmd,
    },
    /// Manage version info
    Version {
        #[command(subcommand)]
        cmd: VersionCmd,
    },
    /// Stage management
    Stage {
        #[command(subcommand)]
        cmd: StageCmd,
    },
    /// Promote a flag to a new stage
    Promote {
        /// Flag name
        name: String,
        /// Target stage code (SP, POC, IP, A, FP, B, EP, CN, RC, GA, LTS, HF, SS, DEP, AR, EOL)
        target_stage: String,
    },
    /// Show status overview
    Status,
    /// Interactive TUI mode
    Tui,
}

#[derive(Subcommand)]
enum FlagCmd {
    List,
    Enable { name: String },
    Disable { name: String },
    Create {
        name: String,
        #[arg(short, long, default_value = "")]
        description: String,
        #[arg(long, default_value = "SP")]
        stage: String,
        #[arg(long, default_value = "F")]
        class: String,
        #[arg(long, value_delimiter = ',', default_value = "dev")]
        channel: Vec<String>,
    },
    /// List flags that should be retired (past their retire_at_stage)
    Audit,
}

#[derive(Subcommand)]
enum ConfigCmd {
    Get { key: String },
    Set {
        key: String,
        value: String,
        #[arg(short, long, default_value = "string")]
        r#type: String,
    },
    List,
    Audit { key: String },
    Restore { key: String, audit_id: i64 },
}

#[derive(Subcommand)]
enum SecretCmd {
    Set { key: String },
    Get { key: String },
    List,
    Delete { key: String },
}

#[derive(Subcommand)]
enum VersionCmd {
    Show,
    Bump {
        #[arg(default_value = ".")]
        repo: String,
        version: String,
    },
    Sync {
        #[arg(default_value = ".")]
        repo: String,
        upstream: String,
    },
}

#[derive(Subcommand)]
enum StageCmd {
    /// Show current repo stage from build info
    Show,
}

fn db_path(repo: &Option<PathBuf>) -> PathBuf {
    let base = repo
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap());
    base.join(".phenotype").join("config.db")
}

fn open_db(repo: &Option<PathBuf>) -> Database {
    let path = db_path(repo);
    Database::open(&path).unwrap_or_else(|e| {
        eprintln!("Failed to open database at {}: {e}", path.display());
        std::process::exit(1);
    })
}

const NS: &str = "default";

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Flags { cmd } => handle_flags(&cli.repo, cmd),
        Commands::Config { cmd } => handle_config(&cli.repo, cmd),
        Commands::Secrets { cmd } => handle_secrets(&cli.repo, cmd),
        Commands::Version { cmd } => handle_version(&cli.repo, cmd),
        Commands::Stage { cmd } => handle_stage(cmd),
        Commands::Promote { name, target_stage } => handle_promote(&cli.repo, name, target_stage),
        Commands::Status => handle_status(&cli.repo),
        Commands::Tui => tui::run(&cli.repo).unwrap_or_else(|e| {
            eprintln!("TUI error: {e}");
            std::process::exit(1);
        }),
    }
}

fn handle_flags(repo: &Option<PathBuf>, cmd: FlagCmd) {
    let db = open_db(repo);
    match cmd {
        FlagCmd::List => {
            let flags = db.list_flags(NS).unwrap();
            if flags.is_empty() {
                println!("No flags.");
                return;
            }
            println!("{:<30} {:<10} {:<6} {:<6} {:<20} {}", "NAME", "ENABLED", "STAGE", "CLASS", "CHANNELS", "DESCRIPTION");
            for f in flags {
                println!(
                    "{:<30} {:<10} {:<6} {:<6} {:<20} {}",
                    f.name,
                    if f.enabled { "yes" } else { "no" },
                    f.stage,
                    f.transience_class,
                    f.channel.join(","),
                    f.description
                );
            }
        }
        FlagCmd::Enable { name } => {
            let mut flag = db.get_flag(NS, &name).unwrap_or(FeatureFlag {
                name: name.clone(),
                enabled: false,
                namespace: NS.to_string(),
                description: String::new(),
                updated_at: Utc::now(),
                stage: "SP".to_string(),
                transience_class: "F".to_string(),
                channel: vec!["dev".to_string()],
                retire_at_stage: None,
            });
            flag.enabled = true;
            flag.updated_at = Utc::now();
            db.set_flag(&flag).unwrap();
            println!("Enabled flag: {name}");
        }
        FlagCmd::Disable { name } => {
            let mut flag = db.get_flag(NS, &name).unwrap_or_else(|_| {
                eprintln!("Flag not found: {name}");
                std::process::exit(1);
            });
            flag.enabled = false;
            flag.updated_at = Utc::now();
            db.set_flag(&flag).unwrap();
            println!("Disabled flag: {name}");
        }
        FlagCmd::Create { name, description, stage, class, channel } => {
            // Validate stage and class
            if stage.parse::<Stage>().is_err() {
                eprintln!("Invalid stage: {stage}");
                std::process::exit(1);
            }
            if class.parse::<TransienceClass>().is_err() {
                eprintln!("Invalid transience class: {class} (use F, C, or X)");
                std::process::exit(1);
            }
            let flag = FeatureFlag {
                name: name.clone(),
                enabled: false,
                namespace: NS.to_string(),
                description,
                updated_at: Utc::now(),
                stage,
                transience_class: class,
                channel,
                retire_at_stage: Some("GA".to_string()),
            };
            db.set_flag(&flag).unwrap();
            println!("Created flag: {name}");
        }
        FlagCmd::Audit => {
            let flags = db.audit_flags(NS).unwrap();
            if flags.is_empty() {
                println!("No flags past their retirement stage.");
                return;
            }
            println!("{:<30} {:<6} {:<10} {}", "NAME", "STAGE", "RETIRE_AT", "DESCRIPTION");
            for f in flags {
                println!(
                    "{:<30} {:<6} {:<10} {}",
                    f.name,
                    f.stage,
                    f.retire_at_stage.as_deref().unwrap_or("-"),
                    f.description
                );
            }
        }
    }
}

fn handle_config(repo: &Option<PathBuf>, cmd: ConfigCmd) {
    let db = open_db(repo);
    match cmd {
        ConfigCmd::Get { key } => {
            let entry = db.get_config(NS, &key).unwrap_or_else(|_| {
                eprintln!("Config not found: {key}");
                std::process::exit(1);
            });
            println!("{} = {} ({})", entry.key, entry.value, entry.value_type);
        }
        ConfigCmd::Set { key, value, r#type } => {
            let vt: ValueType = r#type.parse().unwrap_or_else(|e| {
                eprintln!("{e}");
                std::process::exit(1);
            });
            let entry = ConfigEntry {
                key: key.clone(),
                value,
                value_type: vt,
                namespace: NS.to_string(),
                updated_at: Utc::now(),
                updated_by: whoami(),
            };
            db.set_config(&entry).unwrap();
            println!("Set {key}");
        }
        ConfigCmd::List => {
            let entries = db.list_config(NS).unwrap();
            if entries.is_empty() {
                println!("No config entries.");
                return;
            }
            println!("{:<30} {:<10} {}", "KEY", "TYPE", "VALUE");
            for e in entries {
                println!("{:<30} {:<10} {}", e.key, e.value_type, e.value);
            }
        }
        ConfigCmd::Audit { key } => {
            let records = db.audit_log(NS, &key).unwrap();
            if records.is_empty() {
                println!("No audit records for {key}.");
                return;
            }
            println!("{:<6} {:<25} {:<20} {:<20} {}", "ID", "TIME", "OLD", "NEW", "BY");
            for r in records {
                println!(
                    "{:<6} {:<25} {:<20} {:<20} {}",
                    r.id,
                    r.changed_at.format("%Y-%m-%d %H:%M:%S"),
                    r.old_value.as_deref().unwrap_or("-"),
                    r.new_value,
                    r.changed_by,
                );
            }
        }
        ConfigCmd::Restore { key, audit_id } => {
            let entry = db.restore_config(NS, &key, audit_id).unwrap();
            println!("Restored {} to: {}", key, entry.value);
        }
    }
}

fn handle_secrets(repo: &Option<PathBuf>, cmd: SecretCmd) {
    let db = open_db(repo);
    let key_bytes = pheno_crypto::load_key_from_env().unwrap_or_else(|e| {
        eprintln!("Cannot load encryption key: {e}");
        eprintln!("Set PHENO_SECRET_KEY env var (64-char hex string for 32 bytes)");
        std::process::exit(1);
    });
    match cmd {
        SecretCmd::Set { key } => {
            let plaintext = rpassword::prompt_password("Enter secret value: ").unwrap();
            let (ciphertext, nonce) =
                pheno_crypto::encrypt(plaintext.as_bytes(), &key_bytes).unwrap();
            let entry = SecretEntry {
                key: key.clone(),
                encrypted_value: ciphertext,
                nonce,
                updated_at: Utc::now(),
            };
            db.set_secret(&entry).unwrap();
            println!("Secret stored: {key}");
        }
        SecretCmd::Get { key } => {
            let entry = db.get_secret(&key).unwrap_or_else(|_| {
                eprintln!("Secret not found: {key}");
                std::process::exit(1);
            });
            let plaintext =
                pheno_crypto::decrypt(&entry.encrypted_value, &entry.nonce, &key_bytes).unwrap();
            println!("{}", String::from_utf8_lossy(&plaintext));
        }
        SecretCmd::List => {
            let keys = db.list_secrets().unwrap();
            if keys.is_empty() {
                println!("No secrets.");
                return;
            }
            for k in keys {
                println!("{k}");
            }
        }
        SecretCmd::Delete { key } => {
            db.delete_secret(&key).unwrap();
            println!("Deleted secret: {key}");
        }
    }
}

fn handle_version(repo: &Option<PathBuf>, cmd: VersionCmd) {
    let db = open_db(repo);
    match cmd {
        VersionCmd::Show => {
            let versions = db.list_versions().unwrap();
            if versions.is_empty() {
                println!("No version info.");
                return;
            }
            println!("{:<30} {:<15} {:<15} {}", "REPO", "OURS", "UPSTREAM", "SYNCED");
            for v in versions {
                println!(
                    "{:<30} {:<15} {:<15} {}",
                    v.repo,
                    v.our_version,
                    v.upstream_version,
                    v.synced_at.format("%Y-%m-%d %H:%M:%S"),
                );
            }
        }
        VersionCmd::Bump { repo: name, version } => {
            let mut info = db.get_version(&name).unwrap_or(VersionInfo {
                repo: name.clone(),
                our_version: "0.0.0".to_string(),
                upstream_version: String::new(),
                synced_at: Utc::now(),
            });
            info.our_version = version.clone();
            info.synced_at = Utc::now();
            db.set_version(&info).unwrap();
            println!("Bumped {name} to {version}");
        }
        VersionCmd::Sync {
            repo: name,
            upstream,
        } => {
            let mut info = db.get_version(&name).unwrap_or(VersionInfo {
                repo: name.clone(),
                our_version: "0.0.0".to_string(),
                upstream_version: String::new(),
                synced_at: Utc::now(),
            });
            info.upstream_version = upstream.clone();
            info.synced_at = Utc::now();
            db.set_version(&info).unwrap();
            println!("Synced {name} upstream to {upstream}");
        }
    }
}

fn handle_stage(cmd: StageCmd) {
    match cmd {
        StageCmd::Show => {
            println!("Build stage   : {}", build_info::HELIOS_STAGE);
            println!("Build channel : {}", build_info::HELIOS_CHANNEL);
            println!("Build flags   : {}", if build_info::HELIOS_BUILD_FLAGS.is_empty() { "(none)" } else { build_info::HELIOS_BUILD_FLAGS });
        }
    }
}

fn handle_promote(repo: &Option<PathBuf>, name: String, target_stage: String) {
    let db = open_db(repo);
    db.promote_flag(NS, &name, &target_stage, &whoami()).unwrap_or_else(|e| {
        eprintln!("Promote failed: {e}");
        std::process::exit(1);
    });
    println!("Promoted {name} to stage {target_stage}");
}

fn handle_status(repo: &Option<PathBuf>) {
    let db = open_db(repo);
    let configs = db.list_config(NS).unwrap_or_default();
    let flags = db.list_flags(NS).unwrap_or_default();
    let secrets = db.list_secrets().unwrap_or_default();
    let versions = db.list_versions().unwrap_or_default();
    println!("=== Phenotype Status ===");
    println!("Config entries : {}", configs.len());
    println!("Feature flags  : {} ({} enabled)", flags.len(), flags.iter().filter(|f| f.enabled).count());
    println!("Secrets        : {}", secrets.len());
    println!("Tracked repos  : {}", versions.len());
    println!("Build stage    : {}", build_info::HELIOS_STAGE);
    println!("Build channel  : {}", build_info::HELIOS_CHANNEL);
}

fn whoami() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}
