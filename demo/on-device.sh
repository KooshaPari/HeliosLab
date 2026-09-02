#!/bin/sh
# HeliosLab on-device smoke test
set -e
cd "$(dirname "$0")/.."
PORT="${PORT:-20130}"
BIN="./dist/cli.js"
[ -f "$BIN" ] || { echo "[err] no $BIN — build first"; exit 1; }
node "$BIN" --version
node "$BIN" start --demo --port "$PORT" &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
sleep 1
curl -fsS "http://127.0.0.1:${PORT}/health"
echo ""
echo "[pass] on-device demo OK"
