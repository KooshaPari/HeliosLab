# Runtime Performance Baselines (WP06)

## Scope

This document defines WP06 soak thresholds and failure criteria for slice-1 runtime hardening.

## Soak Scenario

Command:
- `bun test apps/runtime/tests/soak/multi_session_soak.test.ts`

Workload profile:
- 200 lane create commands in concurrent batches.
- 200 session restore attach commands in concurrent batches across multiple session IDs.
- 300 terminal output events with bounded waveform plus periodic spike pressure.

## Baseline Thresholds

- `lane_create_latency_ms`: `p95 <= 30ms`
- `session_restore_latency_ms`: `p95 <= 35ms`
- `terminal_output_backlog_depth`: `p95 <= 64`

Notes:
- Spike samples above `64` are expected in low frequency; gate validity is determined by `p95`, not `max`.
- Session restore latency keeps a strict `35ms` target. If first-run `p95` is within `+3ms` jitter band,
  rerun once and require strict `p95 <= 35ms` on the retry to avoid host-noise flakes.

## Failure Criteria

Any one of the following is a hard failure:

1. Missing metric summary for any required metric.
2. `p95` above threshold for lane create latency.
3. `p95` above threshold for session restore latency.
4. `p95` above threshold for backlog depth.

## Triage Notes

1. Reproduce with focused unit + soak commands.
2. Check `diagnostics.metric` event density in bus event log.
3. For backlog spikes, inspect output producer pacing and backpressure boundaries.
4. For latency drift, inspect synchronous work inside lifecycle handlers.
