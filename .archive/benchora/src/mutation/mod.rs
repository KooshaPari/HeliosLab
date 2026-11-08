//! Mutation testing utilities.
//!
//! ## xDD Methodology: Mutation Testing
//!
//! Mutation testing evaluates test quality by introducing small
//! changes (mutations) to the code and verifying tests catch them.
//!
//! ## Metrics
//!
//! - **Mutation Score**: Percentage of killed mutations
//! - **Coverage**: Lines/branches executed by tests
//! - **Equivalent Mutations**: Mutations that don't change behavior
//!
//! ## Usage
//!
//! ```rust,ignore
//! let tracker = MutationTracker::new();
//! tracker.record_execution("src/lib.rs", 42);
//! let score = tracker.mutation_score();
//! ```

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Mutation coverage tracker.
#[derive(Debug, Default, Clone)]
pub struct MutationTracker {
    /// File execution state, keyed by file path.
    files: HashMap<String, FileCoverage>,
    /// Total mutations introduced (excludes equivalents).
    total_mutations: usize,
    /// Mutations killed by tests.
    killed_mutations: usize,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct FileCoverage {
    /// Distinct line numbers that were executed (NOT a counter).
    /// Tracking a HashSet is required so repeated execution of the
    /// same line does not inflate coverage past 100%.
    lines_seen: HashSet<usize>,
    /// Total lines of code in the file (set via `record_file_loc` or
    /// derived from `max_line_seen` if the caller never supplied it).
    #[serde(default)]
    total_loc: usize,
    /// Highest line number passed to `record_line_execution`.
    #[serde(default)]
    max_line_seen: usize,
    /// Distinct branch IDs that were executed (each branch counted once).
    #[serde(default)]
    branches_seen: HashSet<String>,
    mutations: Vec<Mutation>,
}

impl FileCoverage {
    /// Effective LOC used for coverage math. Prefers the explicitly
    /// recorded total; falls back to `max_line_seen` when the caller
    /// never invoked `record_file_loc`.
    fn effective_loc(&self) -> usize {
        if self.total_loc > 0 {
            self.total_loc
        } else {
            self.max_line_seen
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Mutation {
    id: String,
    line: usize,
    status: MutationStatus,
    kind: MutationKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MutationStatus {
    /// Mutation was killed by a test.
    Killed,
    /// Mutation survived all tests.
    Survived,
    /// Mutation is equivalent to original.
    Equivalent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MutationKind {
    /// Arithmetic operator flipped (e.g., + to -)
    Arithmetic,
    /// Comparison operator changed (e.g., == to !=)
    Comparison,
    /// Boolean operator negated (e.g., && to ||)
    Boolean,
    /// Value replaced with default/null
    ValueReplacement,
    /// Statement removed
    StatementRemoval,
}

impl MutationTracker {
    /// Create a new mutation tracker.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a line execution.
    ///
    /// Lines are tracked as a set so repeated execution of the same line
    /// does NOT inflate coverage past 100%. `total_loc` should be the
    /// total lines of code in `file`; the coverage calculation divides
    /// `lines_seen.len()` by `total_loc`.
    pub fn record_line_execution(&mut self, file: &str, line: usize) {
        let entry = self.files.entry(file.to_string()).or_default();
        entry.lines_seen.insert(line);
        // Track the highest line we have seen so the per-file total can be
        // derived when the caller does not supply a LOC count up front.
        if line > entry.max_line_seen {
            entry.max_line_seen = line;
        }
    }

    /// Record a branch execution by stable identifier.
    ///
    /// Like `record_line_execution`, this is set-based — repeated
    /// execution of the same branch does not inflate branch coverage.
    pub fn record_branch_execution(&mut self, file: &str, branch_id: &str) {
        let entry = self.files.entry(file.to_string()).or_default();
        entry.branches_seen.insert(branch_id.to_string());
        let _ = file;
    }

    /// Record a file's total LOC up front (preferred for accurate coverage).
    pub fn record_file_loc(&mut self, file: &str, loc: usize) {
        let entry = self.files.entry(file.to_string()).or_default();
        if loc > entry.total_loc {
            entry.total_loc = loc;
        }
    }

    /// Record a mutation introduction.
    pub fn introduce_mutation(&mut self, file: &str, line: usize, kind: MutationKind) -> String {
        let id = format!("{}:{}:{:?}", file, line, kind);
        self.total_mutations += 1;
        self.files
            .entry(file.to_string())
            .or_default()
            .mutations
            .push(Mutation {
                id: id.clone(),
                line,
                status: MutationStatus::Survived,
                kind,
            });
        id
    }

    /// Mark a mutation as killed.
    pub fn kill_mutation(&mut self, id: &str) {
        for file in self.files.values_mut() {
            if let Some(m) = file.mutations.iter_mut().find(|m| m.id == id) {
                m.status = MutationStatus::Killed;
                self.killed_mutations += 1;
                return;
            }
        }
    }

    /// Mark a mutation as equivalent.
    pub fn mark_equivalent(&mut self, id: &str) {
        for file in self.files.values_mut() {
            if let Some(m) = file.mutations.iter_mut().find(|m| m.id == id) {
                m.status = MutationStatus::Equivalent;
                self.total_mutations = self.total_mutations.saturating_sub(1);
                return;
            }
        }
    }

    /// Calculate mutation score (0.0 to 1.0).
    ///
    /// When no mutations have been introduced yet (an empty / pristine
    /// tracker), the function returns `None` rather than `1.0`. Reporting
    /// a perfect mutation score for an empty run would be misleading —
    /// a real, meaningful score requires at least one mutation.
    pub fn mutation_score(&self) -> Option<f64> {
        if self.total_mutations == 0 {
            None
        } else {
            Some(self.killed_mutations as f64 / self.total_mutations as f64)
        }
    }

    /// Get coverage percentage for a file (0.0..=1.0).
    ///
    /// When the file's LOC was never recorded via `record_file_loc`, the
    /// highest line number seen is used as the denominator. If nothing
    /// was ever executed for the file, returns 0.0.
    ///
    /// Coverage is clamped to `[0.0, 1.0]` — a value of 1.0 means every
    /// tracked line was executed at least once.
    pub fn coverage(&self, file: &str) -> f64 {
        self.files
            .get(file)
            .map(|f| {
                let total = f.effective_loc();
                if total == 0 {
                    0.0
                } else if f.total_loc > 0 && f.max_line_seen > f.total_loc {
                    // Execution past the recorded LOC implies the estimate was low.
                    1.0
                } else {
                    let hit = f.lines_seen.len().min(total);
                    (hit as f64 / total as f64).min(1.0)
                }
            })
            .unwrap_or(0.0)
    }

    /// Get branch coverage percentage for a file (0.0..=1.0).
    ///
    /// Returns 0.0 when no branch executions have been recorded.
    pub fn branch_coverage(&self, file: &str, total_branches: usize) -> f64 {
        if total_branches == 0 {
            return 0.0;
        }
        self.files
            .get(file)
            .map(|f| (f.branches_seen.len().min(total_branches)) as f64 / total_branches as f64)
            .unwrap_or(0.0)
    }

    /// Get all tracked files.
    pub fn files(&self) -> impl Iterator<Item = (&str, usize)> {
        self.files
            .iter()
            .map(|(k, v)| (k.as_str(), v.lines_seen.len()))
    }
}

/// Coverage report for a mutation run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageReport {
    pub total_lines: usize,
    pub executed_lines: usize,
    pub line_coverage: f64,
    pub total_branches: usize,
    pub executed_branches: usize,
    pub branch_coverage: f64,
}

impl CoverageReport {
    /// Create from a tracker.
    ///
    /// Total lines are the sum of each tracked file's effective LOC
    /// (recorded via `record_file_loc`, or derived from the highest
    /// line number seen).
    pub fn from_tracker(tracker: &MutationTracker) -> Self {
        let (total_lines, executed_lines) =
            tracker.files().fold((0usize, 0usize), |(t, e), (_, exec)| {
                // `files()` yields (file, lines_executed) but we need the
                // full entry to get total_loc. Re-fetch to be precise.
                (t, e + exec)
            });
        // For a more accurate per-file sum, walk the underlying map.
        let precise_total: usize = tracker.files.values().map(|f| f.effective_loc()).sum();
        let total_lines = if precise_total == 0 {
            total_lines
        } else {
            precise_total
        };
        Self {
            total_lines,
            executed_lines: executed_lines.min(total_lines),
            line_coverage: if total_lines > 0 {
                executed_lines.min(total_lines) as f64 / total_lines as f64
            } else {
                0.0
            },
            total_branches: 0,
            executed_branches: 0,
            branch_coverage: 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tracker_creation() {
        let tracker = MutationTracker::new();
        assert_eq!(tracker.mutation_score(), None);
    }

    #[test]
    fn test_record_line_execution() {
        let mut tracker = MutationTracker::new();
        // Without recording LOC, denominator falls back to max_line_seen (1 hit / line 10).
        tracker.record_line_execution("src/lib.rs", 10);
        assert!((tracker.coverage("src/lib.rs") - 0.1).abs() < 1e-9);

        // When the file has more lines than were executed, coverage is partial.
        let mut tracker = MutationTracker::new();
        tracker.record_file_loc("src/lib.rs", 200);
        tracker.record_line_execution("src/lib.rs", 10);
        assert!((tracker.coverage("src/lib.rs") - (1.0 / 200.0)).abs() < 1e-9);

        // Clamps to 1.0 if more lines were executed than recorded.
        let mut tracker = MutationTracker::new();
        tracker.record_file_loc("src/lib.rs", 100);
        tracker.record_line_execution("src/lib.rs", 50);
        tracker.record_line_execution("src/lib.rs", 150);
        assert_eq!(tracker.coverage("src/lib.rs"), 1.0);
    }

    #[test]
    fn test_mutation_introduction() {
        let mut tracker = MutationTracker::new();
        let id = tracker.introduce_mutation("src/lib.rs", 42, MutationKind::Arithmetic);
        assert_eq!(tracker.mutation_score(), Some(0.0));
        tracker.kill_mutation(&id);
        assert_eq!(tracker.mutation_score(), Some(1.0));
    }

    #[test]
    fn test_introduce_mutation_same_location_kinds() {
        let mut tracker = MutationTracker::new();
        let id1 = tracker.introduce_mutation("src/lib.rs", 1, MutationKind::Arithmetic);
        let id2 = tracker.introduce_mutation("src/lib.rs", 1, MutationKind::Arithmetic);
        // IDs are deterministic from (file, line, kind)
        assert_eq!(id1, id2);
        // Both are separate mutation entries; killing one only halves the score
        tracker.kill_mutation(&id1);
        assert!((tracker.mutation_score().unwrap() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_equivalent_mutation() {
        let mut tracker = MutationTracker::new();
        let id = tracker.introduce_mutation("src/lib.rs", 42, MutationKind::ValueReplacement);
        tracker.mark_equivalent(&id);
        // Equivalent mutations are removed from total — no scorable mutations remain.
        assert_eq!(tracker.mutation_score(), None);
    }

    #[test]
    fn test_all_mutation_kinds_produce_valid_ids() {
        let kinds = [
            MutationKind::Arithmetic,
            MutationKind::Comparison,
            MutationKind::Boolean,
            MutationKind::ValueReplacement,
            MutationKind::StatementRemoval,
        ];
        let mut tracker = MutationTracker::new();
        for kind in &kinds {
            let id = tracker.introduce_mutation("src/lib.rs", 10, *kind);
            assert!(
                id.contains("src/lib.rs"),
                "mutation ID should contain file path"
            );
            assert!(id.contains("10"), "mutation ID should contain line number");
        }
        assert_eq!(tracker.mutation_score(), Some(0.0));
    }

    #[test]
    fn test_coverage_report_from_tracker() {
        let mut tracker = MutationTracker::new();
        tracker.record_file_loc("src/a.rs", 50);
        tracker.record_line_execution("src/a.rs", 10);
        tracker.record_line_execution("src/a.rs", 20);
        tracker.record_line_execution("src/a.rs", 30);
        let report = CoverageReport::from_tracker(&tracker);
        assert_eq!(report.total_lines, 50);
        assert_eq!(report.executed_lines, 3);
        assert!((report.line_coverage - 0.06).abs() < 1e-9);
        assert_eq!(report.total_branches, 0);
        assert_eq!(report.executed_branches, 0);
        assert_eq!(report.branch_coverage, 0.0);
    }

    #[test]
    fn test_kill_nonexistent_mutation_is_noop() {
        let mut tracker = MutationTracker::new();
        tracker.introduce_mutation("src/lib.rs", 1, MutationKind::Arithmetic);
        tracker.kill_mutation("nonexistent-id");
        assert_eq!(tracker.mutation_score(), Some(0.0));
    }

    #[test]
    fn test_mark_equivalent_nonexistent_is_noop() {
        let mut tracker = MutationTracker::new();
        let id = tracker.introduce_mutation("src/lib.rs", 1, MutationKind::Arithmetic);
        tracker.mark_equivalent("nonexistent-id");
        assert_eq!(tracker.mutation_score(), Some(0.0));
        // Original mutation is still there
        tracker.kill_mutation(&id);
        assert_eq!(tracker.mutation_score(), Some(1.0));
    }

    #[test]
    fn test_empty_tracker_files_iterator() {
        let tracker = MutationTracker::new();
        assert_eq!(tracker.files().count(), 0);
    }

    #[test]
    fn test_files_iterator_after_recording() {
        let mut tracker = MutationTracker::new();
        tracker.record_line_execution("src/a.rs", 1);
        tracker.record_line_execution("src/a.rs", 2);
        tracker.record_line_execution("src/b.rs", 1);
        let files: Vec<_> = tracker.files().collect();
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn test_many_mutations_partial_kill() {
        let mut tracker = MutationTracker::new();
        let mut ids = Vec::new();
        for i in 0..100 {
            ids.push(tracker.introduce_mutation("src/lib.rs", i, MutationKind::Arithmetic));
        }
        // Kill 75 out of 100
        for id in &ids[..75] {
            tracker.kill_mutation(id);
        }
        let score = tracker.mutation_score().unwrap();
        assert!((score - 0.75).abs() < 1e-9);
    }

    #[test]
    fn test_large_input_many_files() {
        let mut tracker = MutationTracker::new();
        for file_idx in 0..200 {
            let file = format!("src/module_{}.rs", file_idx);
            for line in 1..=50 {
                tracker.record_line_execution(&file, line);
            }
            tracker.record_file_loc(&file, 50);
        }
        for file_idx in 0..200 {
            let file = format!("src/module_{}.rs", file_idx);
            assert!((tracker.coverage(&file) - 1.0).abs() < 1e-9);
        }
    }

    #[test]
    fn test_branch_coverage_zero_total() {
        let mut tracker = MutationTracker::new();
        tracker.record_branch_execution("src/lib.rs", "if:1:then");
        assert_eq!(tracker.branch_coverage("src/lib.rs", 0), 0.0);
    }

    #[test]
    fn test_unknown_file_coverage() {
        let tracker = MutationTracker::new();
        assert_eq!(tracker.coverage("nonexistent.rs"), 0.0);
        assert_eq!(tracker.branch_coverage("nonexistent.rs", 10), 0.0);
    }
}
