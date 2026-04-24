# AGENTS.md — HeliosLab

## Project Overview

- **Name**: HeliosLab (Experimental Development Lab)
- **Description**: Experimental development environment for testing new technologies, prototypes, and research projects across the Phenotype ecosystem
- **Location**: `/Users/kooshapari/CodeProjects/Phenotype/repos/HeliosLab`
- **Language Stack**: TypeScript, Rust, Python, Bun, Node.js
- **Published**: Private (Phenotype org)

## Quick Start Commands

```bash
# Clone and setup
git clone https://github.com/KooshaPari/HeliosLab.git
cd HeliosLab

# Install dependencies
bun install

# Run setup
bun run setup

# Start development
bun run dev

# Run tests
bun test
```

## Architecture

### Experimental Lab Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Experiment Definition Layer                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   Prototypes      │  │   Research      │  │   Benchmarks    │         │
│  │   (MVP)           │  │   (Studies)     │  │   (Tests)       │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
└───────────┼────────────────────┼────────────────────┼────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Multi-Language Runtime                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   TypeScript    │  │   Rust          │  │   Python        │         │
│  │   (Bun/Node)    │  │   (Native)      │  │   (AI/ML)       │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
└───────────┼────────────────────┼────────────────────┼────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Shared Infrastructure                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   Message Bus     │  │   Object Store  │  │   Compute       │         │
│  │   (Events)        │  │   (Artifacts)   │  │   (Containers)    │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────┘
```

### Experiment Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Experiment Lifecycle                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │  Hypothesis│──▶│  Build   │───▶│  Measure │───▶│  Decide  │      │
│  │            │    │          │    │          │    │          │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘      │
│       │               │               │               │             │
│       ▼               ▼               ▼               ▼             │
│  Define Success    Implement       Collect Data    Keep/Kill/      │
│  Criteria          Prototype      Run Benchmarks  Iterate          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Quality Standards

### Code Quality (Experimental)

- **TypeScript**: Biome or Prettier
- **Rust**: rustfmt + clippy
- **Python**: ruff + mypy
- **Tests**: Required before promoting from lab

### Experiment Documentation

- README for each experiment
- Hypothesis documented
- Results measured and recorded
- Decision rationale captured

### Test Requirements

```bash
# TypeScript tests
bun test

# Rust tests
cargo test

# Python tests
pytest

# Integration tests
bun run test:integration
```

## Git Workflow

### Branch Naming

Format: `<type>/<experiment>/<description>`

Types: `exp`, `proto`, `research`, `bench`

Examples:
- `exp/rust/new-allocator`
- `proto/ui/drag-drop-v2`
- `research/ai/llm-quantization`
- `bench/performance/query-optimization`

### Commit Messages

Format: `<type>(<experiment>): <description>`

Examples:
- `exp(rust): implement experimental custom allocator`
- `proto(ui): add drag-and-drop v2 prototype`
- `research(ai): evaluate LLM quantization methods`
- `bench(perf): benchmark new query optimizer`

## File Structure

```
HeliosLab/
├── experiments/            # Active experiments
│   ├── exp-001-rust-allocator/
│   ├── exp-002-ui-dragdrop/
│   └── exp-003-llm-quant/
├── prototypes/             # Working prototypes
│   ├── proto-dashboard-v2/
│   └── proto-mobile-app/
├── research/               # Research notes
│   ├── ai/
│   ├── performance/
│   └── security/
├── benchmarks/             # Benchmark suites
│   ├── query/
│   └── rendering/
├── shared/                 # Shared utilities
│   ├── config/
│   └── scripts/
└── docs/                   # Documentation
```

## CLI Commands

### Experiment Management

```bash
# Create new experiment
bun run exp:create --name exp-004-new-feature

# Run experiment
bun run exp:run --id exp-001

# Measure results
bun run exp:measure --id exp-001

# Archive experiment
bun run exp:archive --id exp-001
```

### Prototypes

```bash
# Build prototype
bun run proto:build --name proto-dashboard-v2

# Test prototype
bun run proto:test --name proto-dashboard-v2

# Deploy prototype
bun run proto:deploy --name proto-dashboard-v2
```

### Benchmarks

```bash
# Run all benchmarks
bun run bench:all

# Run specific benchmark
bun run bench:run --suite query

# Compare results
bun run bench:compare baseline.json current.json
```

## Troubleshooting

### Experiment Failures

```bash
# Check experiment logs
bun run exp:logs --id exp-001

# Debug experiment
bun run exp:debug --id exp-001

# Reset experiment
bun run exp:reset --id exp-001
```

### Build Issues

```bash
# Clean build
bun run clean

# Reinstall dependencies
rm -rf node_modules
bun install

# Check for conflicts
bun run doctor
```

## Environment Variables

```bash
# Lab settings
HELIOSLAB_MODE=experimental
HELIOSLAB_LOG_LEVEL=debug

# Experiment settings
EXP_AUTO_ARCHIVE=30  # days
EXP_MEASURE_TIMEOUT=300

# Compute
HELIOSLAB_COMPUTE_POOL=local
HELIOSLAB_MAX_CONCURRENT=5
```

## Integration Points

| System | Protocol | Purpose |
|--------|----------|---------|
| PhenoMCP | REST | Agent experiments |
| HeliosApp | gRPC | Production promotion |
| Portage | Events | CI/CD integration |

## Governance Rules

### Experiment Guidelines

1. Maximum 30 days per experiment
2. Must have measurable hypothesis
3. Results documented before archival
4. Security review for external exposure

### Promotion Criteria

- Successful experiment results
- Code review passed
- Security audit passed
- Tests >80% coverage

### Review Bot Governance

- Keep CodeRabbit PR blocking at lowest level
- Keep Gemini Code Assist at lowest severity
- Retrigger with comments or no-op commits
- Rate-limit: 120 seconds minimum spacing

---

Last Updated: 2026-04-05
Version: 1.0.0
