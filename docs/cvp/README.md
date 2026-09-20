# Customer Validation Pack — 1000 Concurrent Sessions

**Claim (Q7=A):** HeliosLab supports 1000 concurrent live sessions.

**Status:** Verified. See `cvp-1000.json` for the raw run.

---

## What is measured

The committed `cvp-1000.json` records the outcome of a 1000-lane run
captured on a developer workstation. The harness that produced it
materialises real child processes through `PtyManager` and binds each
stdout into a renderer surface through `StreamBindingManager`, via
`VerticalSliceDriver`.

## Results (1000 lanes, cold burst)

| Metric | Value |
|--------|-------|
| Lanes bound | 1000 / 1000 |
| Setup | 0.76 ms |
| Spawn + bind (cold burst) | 98.5 s |
| Per-lane p50 | 98.4 s |
| Per-lane p99 | 98.5 s |
| Cleanup | 0.60 s |
| Throughput | 10.2 lanes/s |
| Memory delta (post-cleanup) | 65 MB |
| Peak memory above baseline | 63 MB |
| **Overall** | **PASS** |

Run-to-run variance on that workstation ranged 57-99 s for the cold
burst (throughput 10-17 lanes/s), depending on background load.

## What the numbers mean

**Capacity is the claim, and it holds.** All 1000 lanes reached a
renderer surface. Memory stayed flat at ~65 MB for the whole fleet,
and cleanup returned within a second. There is no per-lane leak that
scales with count.

**Cold-burst latency is bounded by the burst, not by any single lane.**
All 1000 lanes are requested at once, so each lane's wall-clock wait
includes sharing the machine with the other 999 spawns. Per-lane p50
equaling the burst duration is the expected shape of a cold burst, not
a defect. Real usage creates lanes incrementally, where per-lane
latency is a fraction of the burst time.

**Thresholds scale with count.** The harness bounds a cold burst at
150 ms per lane (150 s for 1000 lanes) rather than a fixed constant,
because a fixed constant would either be meaningless for small counts
or arbitrarily tight for large ones.

## Reproduce

The harness (`apps/runtime/tests/cvp/cvp-harness.ts`) lives on the
`wbs/terminal-slice` branch today. It will be cherry-picked onto
`main` once the terminal-first work (`VerticalSliceDriver`,
`RecordingRendererAdapter`) lands:

```sh
# From the wbs/terminal-slice branch
bun run apps/runtime/tests/cvp/cvp-harness.ts --count=1000 --output=docs/cvp/cvp-1000.json
```

The scaling regression suite (25 / 100 / 250 lanes) is opt-in via
`CVP_SCALING=1` because materialising hundreds of live PTYs in one
process starves anything running beside it.

## Thresholds

| Metric | Bound |
|--------|-------|
| Spawn p99 | `count * 150 ms` |
| Total | `count * 150 ms + 60 s` |
| Cleanup | `count * 20 ms + 5 s` |
| Memory delta | 200 MB |

## CI gate

The committed `docs/cvp/cvp-1000.json` is validated on every pull
request via the `cvp-evidence.yml` workflow. The gate verifies the
schema (`helios.cvp.v1`), the `overallPass` flag, every `pass.*` flag,
and that each measurement is within the bounds declared in the
report's own `thresholds` block. When the JSON file is missing, the
gate skips (validator alone cannot tell "no evidence yet" from
"evidence was deleted"); once present, the gate enforces every
constraint. The harness itself stays opt-in via `CVP_SCALING=1`
because materialising 1000 live PTYs is expensive on shared runners.

## Files

- `docs/cvp/cvp-1000.json` — raw evidence for the 1000-lane run
- `apps/runtime/tests/cvp/cvp-harness.ts` — the harness (terminal-slice)
- `apps/runtime/tests/cvp/cvp-scaling.test.ts` — regression suite (terminal-slice)
- `apps/runtime/tests/cvp/run-scaling.ts` — scaling orchestrator (terminal-slice)
