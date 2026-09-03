#!/usr/bin/env python3
"""HeliosLab phenoctl-concurrency-stress aggregator.

Reads artifacts/runs.jsonl, aggregates per-subcommand latency + exit-code
counters + per-worker stats, writes artifacts/metrics.json and serves
the GUI dashboard on http://127.0.0.1:9000/ when --watch is set.
"""
import argparse
import json
import pathlib
import statistics
import sys
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_RUNS = ROOT / "artifacts" / "runs.jsonl"
DEFAULT_OUT = ROOT / "artifacts" / "metrics.json"
DASHBOARD_METRICS = ROOT / "assets" / "dashboard" / "metrics.json"
DASHBOARD_FILE = ROOT / "assets" / "dashboard" / "index.html"


def quantile(sorted_vals, q):
    if not sorted_vals:
        return 0
    return sorted_vals[min(int(q * len(sorted_vals)), len(sorted_vals) - 1)]


def aggregate(path: pathlib.Path) -> dict:
    runs = []
    if path.exists():
        with path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    runs.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    n = len(runs)
    if n == 0:
        return {
            "completed_runs": 0, "throughput_per_s": 0.0,
            "lat_ms": {"avg": 0, "p50": 0, "p99": 0, "max": 0, "min": 0},
            "exit_codes": {"ok": 0, "fail": 0, "fail_rate": 0.0},
            "by_cmd": {}, "by_worker": {}, "ts_ms": int(time.time() * 1000),
        }
    lats = sorted(r["lat_ms"] for r in runs)
    ok = sum(1 for r in runs if r["exit_code"] == 0)
    by_cmd = defaultdict(lambda: {"runs": 0, "lat_sum": 0, "fail": 0})
    by_worker = defaultdict(lambda: {"runs": 0, "lat_sum": 0, "fail": 0, "rows": 0})
    for r in runs:
        c = r["cmd"]
        by_cmd[c]["runs"] += 1
        by_cmd[c]["lat_sum"] += r["lat_ms"]
        if r["exit_code"] != 0:
            by_cmd[c]["fail"] += 1
        w = str(r["worker"])
        by_worker[w]["runs"] += 1
        by_worker[w]["lat_sum"] += r["lat_ms"]
        by_worker[w]["rows"] += r.get("rows", 0)
        if r["exit_code"] != 0:
            by_worker[w]["fail"] += 1
    by_cmd_out = {k: {"runs": v["runs"], "avg_lat_ms": round(v["lat_sum"] / max(v["runs"], 1), 2),
                      "fail": v["fail"], "fail_rate": round(v["fail"] / max(v["runs"], 1), 4)}
                   for k, v in by_cmd.items()}
    by_worker_out = {k: {"runs": v["runs"], "avg_lat_ms": round(v["lat_sum"] / max(v["runs"], 1), 2),
                         "rows": v["rows"], "fail": v["fail"]}
                      for k, v in by_worker.items()}
    elapsed_s = max(1, (int(time.time() * 1000) - int(path.stat().st_mtime * 1000)) / 1000.0) if path.exists() else 1.0
    return {
        "completed_runs": n,
        "throughput_per_s": round(n / elapsed_s, 2),
        "lat_ms": {
            "avg": int(statistics.mean(lats)),
            "p50": int(quantile(lats, 0.50)),
            "p99": int(quantile(lats, 0.99)),
            "max": int(max(lats)),
            "min": int(min(lats)),
        },
        "exit_codes": {"ok": ok, "fail": n - ok, "fail_rate": round((n - ok) / max(1, n), 4)},
        "by_cmd": by_cmd_out,
        "by_worker": by_worker_out,
        "ts_ms": int(time.time() * 1000),
    }


def write_metrics(m, out: pathlib.Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        json.dump(m, f, indent=2)


def serve_dashboard(port: int, dashboard: pathlib.Path, metrics: pathlib.Path):
    if not dashboard.exists():
        print(f"dashboard not found: {dashboard}", file=sys.stderr)
        return

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/metrics.json"):
                m = aggregate(metrics) if metrics.exists() else {"completed_runs": 0}
                body = json.dumps(m).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(body)
            else:
                with dashboard.open("rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        def log_message(self, *_):
            return

    print(f"[phenoctl-concurrency-stress] dashboard: http://127.0.0.1:{port}/", flush=True)
    HTTPServer(("127.0.0.1", port), H).serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--port", type=int, default=9001)
    ap.add_argument("--runs", type=pathlib.Path, default=DEFAULT_RUNS)
    ap.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    a = ap.parse_args()
    if a.watch:
        write_metrics(aggregate(a.runs), a.out)
        write_metrics(aggregate(a.runs), DASHBOARD_METRICS)
        import threading
        def poll():
            while True:
                time.sleep(1)
                m = aggregate(a.runs)
                write_metrics(m, a.out)
                write_metrics(m, DASHBOARD_METRICS)
        threading.Thread(target=poll, daemon=True).start()
        serve_dashboard(a.port, DASHBOARD_FILE, a.out)
    else:
        m = aggregate(a.runs)
        write_metrics(m, a.out)
        print(json.dumps(m, indent=2))


if __name__ == "__main__":
    main()
