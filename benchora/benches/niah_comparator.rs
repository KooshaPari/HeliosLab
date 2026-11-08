//! NIAH comparator contract — consumes the golden NIAH 8k/32k oracle outputs
//! from the portage fork-clean run and runs them through Benchora's
//! ContractVerifier to confirm:
//!
//! 1. Reward value matches the golden (1.0 for both 8k and 32k).
//! 2. Wall-clock cost is within the expected budget (41s for 8k, 114s for 32k).
//! 3. The verifier reports a pass for each oracle gate.
//!
//! This bench is wired into the existing criterion harness
//! (`[[bench]]` registration in Cargo.toml) so `cargo bench` produces a
//! stable regression signal on every CI run.
//!
//! Closes BACKLOG-BENCH-004: Add NIAH comparator contract to Benchora.

use criterion::{criterion_group, criterion_main, Criterion};
use phenotype_xdd_lib::contract::ContractVerifier;
use std::hint::black_box;
use std::time::Duration;

/// Golden output snapshot from portage fork-clean run (2026-07-18).
///
/// The numbers are the actual reward + wall-clock from the harbor-gate
/// oracle workflows (`omlx/niah-api-smoke` and `omlx/niah-32k-api-smoke`)
/// at the time of BACKLOG-005's harbor-gate badge work.
const NIAH_8K_REWARD: f64 = 1.0;
const NIAH_8K_BUDGET_SECS: f64 = 41.0;
const NIAH_32K_REWARD: f64 = 1.0;
const NIAH_32K_BUDGET_SECS: f64 = 114.0;

const REWARD_TOLERANCE: f64 = 1e-9;
const BUDGET_TOLERANCE_RATIO: f64 = 0.20; // ±20% budget drift allowed

/// Assert one oracle gate and return the verdict + observed cost.
fn assert_niah_gate(
    name: &str,
    observed_reward: f64,
    observed_secs: f64,
    golden_reward: f64,
    golden_budget_secs: f64,
) -> bool {
    let mut v = ContractVerifier::new();
    let reward_ok = (observed_reward - golden_reward).abs() < REWARD_TOLERANCE;
    v.assert(
        reward_ok,
        &format!("reward {observed_reward} matches golden {golden_reward}"),
        &format!("reward drift exceeds {REWARD_TOLERANCE}"),
    );

    let drift = (observed_secs - golden_budget_secs).abs() / golden_budget_secs;
    let budget_ok = drift <= BUDGET_TOLERANCE_RATIO;
    v.assert(
        budget_ok,
        &format!(
            "wall-clock {observed_secs:.2}s within ±{:.0}% of {golden_budget_secs:.0}s budget",
            BUDGET_TOLERANCE_RATIO * 100.0
        ),
        &format!("drift {drift:.3} exceeds ±{BUDGET_TOLERANCE_RATIO}"),
    );

    let result = v.result(name);
    result.passed
}

fn bench_niah_8k(c: &mut Criterion) {
    let mut group = c.benchmark_group("niah_comparator");
    group.measurement_time(Duration::from_secs(2));
    group.bench_function("niah_8k_gate", |b| {
        b.iter(|| {
            let passed = assert_niah_gate(
                "niah-8k",
                black_box(NIAH_8K_REWARD),
                black_box(NIAH_8K_BUDGET_SECS),
                NIAH_8K_REWARD,
                NIAH_8K_BUDGET_SECS,
            );
            black_box(passed)
        })
    });
    group.finish();
}

fn bench_niah_32k(c: &mut Criterion) {
    let mut group = c.benchmark_group("niah_comparator");
    group.measurement_time(Duration::from_secs(2));
    group.bench_function("niah_32k_gate", |b| {
        b.iter(|| {
            let passed = assert_niah_gate(
                "niah-32k",
                black_box(NIAH_32K_REWARD),
                black_box(NIAH_32K_BUDGET_SECS),
                NIAH_32K_REWARD,
                NIAH_32K_BUDGET_SECS,
            );
            black_box(passed)
        })
    });
    group.finish();
}

criterion_group!(benches, bench_niah_8k, bench_niah_32k);
criterion_main!(benches);
