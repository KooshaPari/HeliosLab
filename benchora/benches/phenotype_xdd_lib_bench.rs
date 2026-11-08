//! Property + contract + spec benchmark suite for Benchora.
//!
//! Registered as the `phenotype_xdd_lib_bench` bench file in Cargo.toml,
//! so `benchora run --suite property|contract|spec` invokes *these*
//! benchmarks (not the noop `my_benchmark`). Each benchmark measures
//! a real xDD-lib path: proptest strategy generation, contract
//! verification, and spec parsing/validation respectively.
//!
//! Runs through criterion's standard harness (`--bench`); the CLI
//! parses the bencher-format JSON to build a canonical report.

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use phenotype_xdd_lib::contract::ContractVerifier;
use phenotype_xdd_lib::property::strategies::{
    bounded_int, non_empty, non_empty_string, valid_email, valid_uuid,
};
use phenotype_xdd_lib::spec::{Spec, SpecMetadata, SpecParser, SpecValidator};

fn bench_property(c: &mut Criterion) {
    let mut group = c.benchmark_group("property");

    // Measure validator cost for the most common cases (uuid, email,
    // non-empty). Each runs a tight inner loop via `iter_batched`.
    group.bench_function(BenchmarkId::new("valid_uuid_ok", 36), |b| {
        b.iter(|| valid_uuid("550e8400-e29b-41d4-a716-446655440000").unwrap());
    });
    group.bench_function(BenchmarkId::new("valid_email_ok", 17), |b| {
        b.iter(|| valid_email("user@example.com").unwrap());
    });
    group.bench_function(BenchmarkId::new("non_empty_ok", 5), |b| {
        b.iter(|| non_empty_string("hello").unwrap());
    });
    group.bench_function(BenchmarkId::new("bounded_int_ok", 50), |b| {
        b.iter(|| bounded_int(50, 0, 100).unwrap());
    });

    // Throughput-oriented: validating a slice of many values.
    let workload: Vec<i64> = (0..1024).collect();
    group.throughput(Throughput::Elements(workload.len() as u64));
    group.bench_function(BenchmarkId::new("non_empty_slice", workload.len()), |b| {
        b.iter(|| non_empty(&workload).unwrap());
    });
    group.finish();
}

fn bench_contract(c: &mut Criterion) {
    let mut group = c.benchmark_group("contract");

    // ContractVerifier is a thin wrapper; the real cost is in
    // `verify::<C: Contract>()` where the contract body executes.
    // We exercise the assert/assert_eq/result paths here.
    for n_assertions in [10usize, 100, 1000] {
        group.throughput(Throughput::Elements(n_assertions as u64));
        group.bench_function(BenchmarkId::new("verifier_asserts", n_assertions), |b| {
            b.iter(|| {
                let mut v = ContractVerifier::new();
                for i in 0..n_assertions {
                    v.assert(i < n_assertions, "i < n", "i >= n");
                }
                v.result("contract-bench");
            });
        });
    }
    group.finish();
}

fn bench_spec(c: &mut Criterion) {
    let mut group = c.benchmark_group("spec");
    let yaml = r#"
spec:
  name: Benchmark Spec
  version: 1.0.0
features:
  - id: BENCH-001
    name: Benchmark Feature
    given:
      - description: initial condition
    when:
      - description: action performed
    then:
      - description: expected outcome
"#;

    group.bench_function("parse_yaml_typical", |b| {
        b.iter(|| SpecParser::parse(yaml).unwrap());
    });
    group.bench_function("validate_typical", |b| {
        let spec = Spec {
            spec: SpecMetadata {
                name: "Benchmark Spec".into(),
                version: "1.0.0".into(),
                description: None,
            },
            features: vec![],
            requirements: vec![],
        };
        b.iter(|| SpecValidator::new().validate(&spec).unwrap());
    });
    group.finish();
}

criterion_group!(benches, bench_property, bench_contract, bench_spec);
criterion_main!(benches);
