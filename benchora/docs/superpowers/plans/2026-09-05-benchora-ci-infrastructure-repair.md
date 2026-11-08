# Benchora CI Infrastructure Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reproducible Clippy and Gitleaks PR checks without changing Benchora's scorecard governance threshold.

**Architecture:** Move lint-level configuration out of unsupported `clippy.toml` keys while retaining its supported numeric thresholds. Keep the existing `-D warnings` CI contract, and give the Gitleaks job a complete checkout so its PR revision range exists locally. Scorecard remains unchanged because its 32/88 baseline versus the 35 threshold is a policy decision, not a runtime defect.

**Tech Stack:** GitHub Actions YAML, Cargo/Clippy nightly, Gitleaks, Python scorecard script.

---

### Task 1: Establish the failing Clippy regression command

**Files:**
- Modify: `clippy.toml:1-25`
- Test: local command only; no production source changes

- [ ] **Step 1: Run the current failing command and retain the exact failure**

Run:

```bash
cargo +nightly clippy --all-features --all-targets -- -D warnings
```

Expected: FAIL with `unknown field name` for `warn` and `allow` in `clippy.toml`.

- [ ] **Step 2: Remove only unsupported lint-level keys from `clippy.toml`**

Keep the supported threshold entries exactly as follows:

```toml
# Clippy lints configuration
# https://rust-lang.github.io/rust-clippy/

# Cognitive complexity threshold
cognitive-complexity-threshold = 30

# Too many arguments threshold
too-many-arguments-threshold = 8

# Type complexity threshold
type-complexity-threshold = 250
```

- [ ] **Step 3: Re-run Clippy to prove the parser defect is gone**

Run:

```bash
cargo +nightly clippy --all-features --all-targets -- -D warnings
```

Expected: exit 0. If source warnings appear after configuration parsing succeeds, stop and report them as a separate code-quality scope rather than weakening the check.

- [ ] **Step 4: Commit the isolated configuration repair**

```bash
git add clippy.toml
git commit -m "fix(ci): restore supported Clippy configuration"
```

### Task 2: Establish the shallow-checkout Gitleaks regression

**Files:**
- Modify: `.github/workflows/ci.yml:178-186`
- Test: workflow YAML inspection plus targeted Gitleaks range reproduction

- [ ] **Step 1: Verify the current job checks out one commit before Gitleaks**

Run:

```bash
sed -n '178,190p' .github/workflows/ci.yml
```

Expected: the `security` job uses `actions/checkout@v7` with no `fetch-depth`, so GitHub Actions supplies the default shallow checkout.

- [ ] **Step 2: Configure a complete checkout only for the Gitleaks job**

Change the security job checkout to:

```yaml
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
```

Do not alter the detect, dependency-review, build, or test checkouts; Gitleaks alone requires revision ancestry for pull-request range scanning.

- [ ] **Step 3: Validate syntax and range availability**

Run:

```bash
git diff --check
git rev-parse origin/main
git merge-base origin/main HEAD
```

Expected: exit 0 for every command. This establishes that the workflow requests the history required by Gitleaks; hosted execution remains the final proof.

- [ ] **Step 4: Commit the isolated security checkout repair**

```bash
git add .github/workflows/ci.yml
git commit -m "fix(ci): fetch PR history for Gitleaks"
```

### Task 3: Repair the pre-existing Rustfmt regression

**Files:**
- Modify: `benches/niah_comparator.rs:15,50-55`
- Test: `cargo +nightly fmt --all -- --check`

- [ ] **Step 1: Confirm the failure is unchanged from `main`**

Run:

```bash
git diff --quiet origin/main...HEAD -- benches/niah_comparator.rs
cargo +nightly fmt --all -- --check
```

Expected: the file has no branch-specific diff before repair and Rustfmt reports only its canonical formatting changes.

- [ ] **Step 2: Apply the canonical Rustfmt output**

Run:

```bash
cargo +nightly fmt --all
```

Expected: only `benches/niah_comparator.rs` changes, with reordered Criterion imports and wrapped `format!` arguments.

- [ ] **Step 3: Verify the formatting regression is resolved**

Run:

```bash
cargo +nightly fmt --all -- --check
```

Expected: exit 0.

- [ ] **Step 4: Commit the isolated formatting repair**

```bash
git add benches/niah_comparator.rs
git commit -m "style: format NIAH comparator benchmark"
```

### Task 4: Validate scope and preserve the governance boundary

**Files:**
- Create: `docs/superpowers/plans/2026-09-05-benchora-ci-infrastructure-repair.md`
- Test: `scripts/scorecard_ci.py`

- [ ] **Step 1: Re-run the CI-relevant local checks**

Run:

```bash
cargo +nightly fmt --all -- --check
cargo +nightly clippy --all-features --all-targets -- -D warnings
python3 scripts/scorecard_ci.py . --output json --threshold 35 --fail-on-drop
```

Expected: format and Clippy exit 0. The scorecard remains below its threshold; preserve that result without changing the threshold.

- [ ] **Step 2: Inspect the complete diff against `main`**

Run:

```bash
git diff main...HEAD --check
git diff --stat main...HEAD
```

Expected: only `clippy.toml`, `.github/workflows/ci.yml`, and this plan are changed.

- [ ] **Step 3: Commit the approved plan artifact**

```bash
git add docs/superpowers/plans/2026-09-05-benchora-ci-infrastructure-repair.md
git commit -m "docs(plan): record Benchora CI infrastructure repair"
```

- [ ] **Step 4: Stop before remote mutation**

Do not push, modify an existing PR, alter the scorecard threshold, or merge. Report the local commit IDs and the remaining hosted rerun gate.
