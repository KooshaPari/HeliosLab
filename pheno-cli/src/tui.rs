use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    ExecutableCommand,
};
use pheno_core::*;
use pheno_db::Database;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, List, ListItem, Paragraph, Tabs},
};
use std::io::stdout;
use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq)]
enum Tab {
    Config,
    Flags,
    Secrets,
    Versions,
}

impl Tab {
    const ALL: [Tab; 4] = [Tab::Config, Tab::Flags, Tab::Secrets, Tab::Versions];

    fn title(self) -> &'static str {
        match self {
            Tab::Config => "Config",
            Tab::Flags => "Flags",
            Tab::Secrets => "Secrets",
            Tab::Versions => "Versions",
        }
    }

    fn index(self) -> usize {
        Self::ALL.iter().position(|&t| t == self).unwrap()
    }
}

pub fn run(repo: &Option<PathBuf>) -> pheno_core::Result<()> {
    let db_path = repo
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap())
        .join(".phenotype")
        .join("config.db");
    let db = Database::open(&db_path)?;

    enable_raw_mode().map_err(|e| Error::Other(e.to_string()))?;
    stdout()
        .execute(EnterAlternateScreen)
        .map_err(|e| Error::Other(e.to_string()))?;

    let backend = CrosstermBackend::new(stdout());
    let mut terminal = Terminal::new(backend).map_err(|e| Error::Other(e.to_string()))?;

    let mut tab = Tab::Config;

    loop {
        terminal
            .draw(|frame| draw(frame, &db, tab))
            .map_err(|e| Error::Other(e.to_string()))?;

        if let Ok(Event::Key(key)) = event::read() {
            if key.kind != KeyEventKind::Press {
                continue;
            }
            match key.code {
                KeyCode::Char('q') | KeyCode::Esc => break,
                KeyCode::Tab | KeyCode::Right => {
                    let idx = (tab.index() + 1) % Tab::ALL.len();
                    tab = Tab::ALL[idx];
                }
                KeyCode::BackTab | KeyCode::Left => {
                    let idx = (tab.index() + Tab::ALL.len() - 1) % Tab::ALL.len();
                    tab = Tab::ALL[idx];
                }
                _ => {}
            }
        }
    }

    disable_raw_mode().map_err(|e| Error::Other(e.to_string()))?;
    stdout()
        .execute(LeaveAlternateScreen)
        .map_err(|e| Error::Other(e.to_string()))?;
    Ok(())
}

fn draw(frame: &mut Frame, db: &Database, tab: Tab) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0)])
        .split(frame.area());

    let titles: Vec<&str> = Tab::ALL.iter().map(|t| t.title()).collect();
    let tabs_widget = Tabs::new(titles)
        .select(tab.index())
        .block(Block::default().borders(Borders::ALL).title("phenoctl"))
        .highlight_style(Style::default().fg(Color::Yellow).bold());
    frame.render_widget(tabs_widget, chunks[0]);

    let content_block = Block::default().borders(Borders::ALL).title(tab.title());

    match tab {
        Tab::Config => {
            let entries = db.list_config("default").unwrap_or_default();
            let items: Vec<ListItem> = entries
                .iter()
                .map(|e| ListItem::new(format!("{} = {} ({})", e.key, e.value, e.value_type)))
                .collect();
            let list = List::new(items).block(content_block);
            frame.render_widget(list, chunks[1]);
        }
        Tab::Flags => {
            let flags = db.list_flags("default").unwrap_or_default();
            let items: Vec<ListItem> = flags
                .iter()
                .map(|f| {
                    let status = if f.enabled { "[x]" } else { "[ ]" };
                    ListItem::new(format!("{status} {} - {}", f.name, f.description))
                })
                .collect();
            let list = List::new(items).block(content_block);
            frame.render_widget(list, chunks[1]);
        }
        Tab::Secrets => {
            let keys = db.list_secrets().unwrap_or_default();
            let items: Vec<ListItem> = keys
                .iter()
                .map(|k| ListItem::new(format!("{k} (encrypted)")))
                .collect();
            let list = List::new(items).block(content_block);
            frame.render_widget(list, chunks[1]);
        }
        Tab::Versions => {
            let versions = db.list_versions().unwrap_or_default();
            let items: Vec<ListItem> = versions
                .iter()
                .map(|v| {
                    ListItem::new(format!(
                        "{}: {} (upstream: {})",
                        v.repo, v.our_version, v.upstream_version
                    ))
                })
                .collect();
            let list = List::new(items).block(content_block);
            frame.render_widget(list, chunks[1]);
        }
    }

    // Help footer
    let help = Paragraph::new("Tab/Arrow: switch tabs | q/Esc: quit")
        .style(Style::default().fg(Color::DarkGray));
    let footer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(1)])
        .split(chunks[1]);
    frame.render_widget(help, footer[1]);
}
