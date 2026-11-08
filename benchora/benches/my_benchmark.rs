use criterion::{criterion_group, criterion_main, Criterion};
use phenotype_xdd_lib::property::strategies::valid_uuid;
use std::hint::black_box;

/// Smoke-test bench: validates that the bench harness is wired up
/// correctly. The actual measurement is a single `valid_uuid` call,
/// which exercises the library's property validator code path on every
/// iteration while staying fast enough that CI finishes in seconds.
///
/// Real per-suite benches (property/contract/spec) live in
/// `phenotype_xdd_lib_bench.rs`.
fn benchmark(c: &mut Criterion) {
    c.bench_function("noop", |b| {
        b.iter(|| {
            // Mix the noop with a real lib call so the harness always
            // touches user code at least once per iteration.
            let _ = black_box(valid_uuid("550e8400-e29b-41d4-a716-446655440000"));
            black_box(42)
        })
    });
}

criterion_group!(benches, benchmark);
criterion_main!(benches);
