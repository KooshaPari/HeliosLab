#[cfg(test)]
mod tests {
    use phenotype_xdd_lib::mutation::{MutationKind, MutationTracker};

    #[test]
    fn now_iso_returns_non_empty_string() {
        let ts = phenotype_xdd_lib::cli::baseline::now_iso();
        assert!(!ts.is_empty(), "now_iso() should return a non-empty string");
        assert!(
            ts.ends_with('Z'),
            "now_iso() should produce an RFC3339-ish timestamp ending in Z, got: {ts}"
        );
    }

    #[test]
    fn epoch_to_ymdhms_epoch_zero() {
        let (year, month, day, hour, min, sec) =
            phenotype_xdd_lib::cli::baseline::epoch_to_ymdhms(0);
        assert_eq!(year, 1970);
        assert_eq!(month, 1);
        assert_eq!(day, 1);
        assert_eq!(hour, 0);
        assert_eq!(min, 0);
        assert_eq!(sec, 0);
    }

    #[test]
    fn spec_default_parses_without_error() {
        let spec = phenotype_xdd_lib::spec::Spec::default();
        assert!(
            spec.spec.name.is_empty(),
            "default Spec should have an empty name"
        );
        assert!(
            spec.spec.version.is_empty(),
            "default Spec should have an empty version"
        );
        assert!(spec.features.is_empty());
        assert!(spec.requirements.is_empty());
    }

    #[test]
    fn coverage_uses_set_not_counter() {
        let mut tracker = MutationTracker::new();
        tracker.record_file_loc("src/lib.rs", 100);
        for _ in 0..10_000 {
            tracker.record_line_execution("src/lib.rs", 42);
        }
        let cov = tracker.coverage("src/lib.rs");
        assert!(
            (cov - 0.01).abs() < 1e-9,
            "coverage should be 0.01 (1/100), got {cov}"
        );
    }

    #[test]
    fn branch_coverage_dedupes() {
        let mut tracker = MutationTracker::new();
        for _ in 0..100 {
            tracker.record_branch_execution("src/lib.rs", "if:42:then");
            tracker.record_branch_execution("src/lib.rs", "if:42:else");
        }
        let cov = tracker.branch_coverage("src/lib.rs", 4);
        assert!(
            (cov - 0.5).abs() < 1e-9,
            "branch coverage should be 0.5 (2/4), got {cov}"
        );
    }

    #[test]
    fn mutation_score_none_when_empty() {
        let tracker = MutationTracker::new();
        assert_eq!(tracker.mutation_score(), None);
    }

    #[test]
    fn mutation_score_zero_when_survived() {
        let mut tracker = MutationTracker::new();
        tracker.introduce_mutation("src/lib.rs", 42, MutationKind::Arithmetic);
        assert_eq!(tracker.mutation_score(), Some(0.0));
    }

    #[test]
    fn mutation_score_one_when_killed() {
        let mut tracker = MutationTracker::new();
        let id = tracker.introduce_mutation("src/lib.rs", 42, MutationKind::Arithmetic);
        tracker.kill_mutation(&id);
        assert_eq!(tracker.mutation_score(), Some(1.0));
    }

    #[test]
    fn mutation_score_ignores_equivalents() {
        let mut tracker = MutationTracker::new();
        let mut ids = Vec::new();
        for i in 0..10 {
            ids.push(tracker.introduce_mutation("src/lib.rs", i, MutationKind::Arithmetic));
        }
        tracker.kill_mutation(&ids[0]);
        tracker.kill_mutation(&ids[1]);
        for id in &ids[2..5] {
            tracker.mark_equivalent(id);
        }
        let score = tracker.mutation_score().expect("non-empty");
        assert!((score - (2.0 / 7.0)).abs() < 1e-9, "got {score}");
    }
}
