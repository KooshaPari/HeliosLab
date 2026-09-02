# Benchmark Plan

Date: 2026-02-26
Objective: Validate Helios v1 constraints for memory, responsiveness, and concurrency.

## Acceptance thresholds

- Memory:
  - Target: <500 MB steady-state at reference workload
- Startup:
  - Target: interactive in <2.0 seconds
- Latency:
  - Target: median input-to-render <60 ms
- Concurrency:
  - Target: 25 concurrent terminals with no hard UI freeze

## Workload profiles

### Profile A: Normal dev
- 8 terminals
- 2 projects
- mixed command output

### Profile B: Heavy multitask
- 16 terminals
- 4 projects
- continuous logs + build/test output

### Profile C: Swarm stress
- 25 terminals
- 6+ worktree lanes via `par`
- periodic share sessions via upterm/tmate
- renderer switch operation during load

## Metrics to collect

- rss_mb
- renderer_frame_time_ms_p50/p95
- terminal_output_backlog_bytes
- lane_create_time_ms
- session_restore_time_ms
- renderer_switch_duration_ms
- share_session_start_ms
- policy_eval_duration_ms

## Test cadence

- Per-commit smoke: Profile A
- Daily stress: Profile B
- Nightly soak: Profile C for >=2 hours

## Pass/Fail rules

- Fail if any threshold violated for 3 consecutive runs
- Fail immediately on data-loss in session restore
- Fail immediately on policy bypass

## Release Closure Execution Matrix

| Gate | Profile | Focus | Required output |
| --- | --- | --- | --- |
| Policy and safety | A | blocked commands, protected paths, redaction, share approval | regression log + redaction sample |
| Durability and replay | A/B | checkpoint, restart, restore, replay export | restore log + replay sample |
| Provider conformance | A | adapter isolation, timeout/retry, audit coverage | conformance output + audit sample |
| Performance stress | B | startup, memory, latency under sustained output | benchmark report |
| Swarm soak | C | 25 terminals, lane churn, share-session load, renderer switch | soak log + threshold summary |

## Release Evidence Bundle

- benchmark profile results for A, B, and C
- startup timing summary
- memory ceiling summary
- latency summary
- renderer switch duration summary
- session restore timing summary
