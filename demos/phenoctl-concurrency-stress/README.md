# phenoctl-concurrency-stress

GUI/visual stress-test demo for HeliosLab's `phenoctl` CLI. Spawns N concurrent
bash workers invoking `status`, `flags list`, `config list`, `stage show`,
`version show`, `events list` against a sandbox repo and serves a live HTML
dashboard on http://127.0.0.1:9001/.

## Build prerequisite

```bash
cd HeliosLab
cargo build -p pheno-cli
```

## Run

```bash
# terminal 1: stress driver (N=8, duration_s=15)
N=8 duration_s=15 bash demos/phenoctl-concurrency-stress/scripts/stress.sh

# terminal 2: aggregator + dashboard
python3 demos/phenoctl-concurrency-stress/scripts/aggregate.py --watch --port 9001
```

Open http://127.0.0.1:9001/ while the demo runs.

## What it stresses

| Dimension | How |
|---|---|
| Concurrent phenoctl invocations | N parallel bash workers |
| Per-subcommand latency | wall-clock per call, p50/p99 captured |
| Exit-code distribution | OK vs fail ratio under contention |
| CLI serialization | DB-lock contention on pheno-db |

## Files

- `scripts/stress.sh` — N workers × duration_s against sandbox repo
- `scripts/aggregate.py` — reads `artifacts/runs.jsonl`, writes `metrics.json`, serves dashboard
- `assets/dashboard/index.html` — GUI (served at runtime)
- `artifacts/runs.jsonl` — per-invocation telemetry
