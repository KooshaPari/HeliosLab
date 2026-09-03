#!/usr/bin/env bash
# HeliosLab phenoctl concurrency stress driver.
# N concurrent workers invoke various phenoctl subcommands against a temp
# repo for `duration_s` seconds, writing one JSON line per invocation.
set -euo pipefail
N="${N:-8}"
DURATION_S="${duration_s:-15}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PHENOCTL="${REPO_ROOT}/target/debug/phenoctl"
[ -x "$PHENOCTL" ] || { echo "binary not built: $PHENOCTL (cargo build -p pheno-cli)"; exit 1; }

# Use a sandbox repo for the flag operations
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
(
  cd "$SANDBOX"
  git init -q . 2>/dev/null || true
  echo "sandbox" > README.md
)

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_JSONL="${HERE}/../artifacts/runs.jsonl"
mkdir -p "$(dirname "$OUT_JSONL")"
: > "$OUT_JSONL"

CMDS=(
  "status"
  "flags list"
  "config list"
  "stage show"
  "version show"
  "events list"
)

STOP_FILE="$(mktemp -u)"
( sleep "$DURATION_S"; touch "$STOP_FILE" ) &

for ((i=0;i<N;i++)); do
  (
    while [ ! -f "$STOP_FILE" ]; do
      cmd="${CMDS[$((RANDOM % ${#CMDS[@]}))]}"
      t_start=$(date +%s%N)
      out=$("$PHENOCTL" "$cmd" --repo "$SANDBOX" 2>&1) || true
      rc=$?
      t_end=$(date +%s%N)
      lat_ms=$(( (t_end - t_start) / 1000000 ))
      rows=$(echo "$out" | grep -cE '^[[:alnum:]._]' || echo 0)
      printf '{"worker":%d,"cmd":"%s","lat_ms":%d,"exit_code":%d,"rows":%d}\n' \
        "$i" "$cmd" "$lat_ms" "$rc" "$rows" >> "$OUT_JSONL"
    done
  ) &
done
wait
rm -f "$STOP_FILE"

echo "wrote $OUT_JSONL ($(wc -l < "$OUT_JSONL") runs)"
