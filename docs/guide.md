# Install and Run

## Requirements

- Python 3.11 or newer.
- `pip` or `uv` for editable local installs.
- Optional: `task` for the repo command runner.

## Install

```bash
git clone https://github.com/KooshaPari/heliosBench.git
cd heliosBench
pip install -e .
```

For development dependencies:

```bash
pip install -e ".[dev]"
```

## List Tasks

```bash
helios-bench tasks
```

## Run One Benchmark

```bash
helios-bench run --binary /path/to/codex --task palindrome --runs 5
```

The result captures latency, CPU, RSS, file descriptor count, and thread count.

## Compare Two Binaries

```bash
helios-bench compare --binary-a custom-codex --binary-b homebrew-codex
```

Use this when testing agent wrapper changes, shell-output compression harnesses,
or runtime upgrades.

## Leak Detection

```bash
helios-bench leak --binary /path/to/codex --runs 20
```

Leak mode repeats the benchmark and watches resource growth across runs.
