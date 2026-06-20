# HeliosLab Justfile
#
# After 2026-06-11, this justfile is a thin shell that re-exports the shared
# `phenotype.just` library (defined in just/phenotype.just). The most common
# recipes (default, build, test, lint, fmt, audit, unused, ci, docs) are
# defined once in the library and parameterized over the build system.
#
# Stack-specific recipes (`deny`, `grade`) stay in this file so the library
# stays polyglot-neutral.
#
# To upgrade: pull the latest phenotype.just from the central repo, or
# vendor it as a git submodule.

import "just/phenotype.just"

# Run cargo-deny against the checked-in deny.toml policy.
# Stack: cargo. Hard-fails if cargo-deny is not installed (mirrors CI).
deny:
    @if [ -f Cargo.toml ]; then \
        command -v cargo-deny >/dev/null || { echo "cargo-deny not installed; install with: cargo install cargo-deny"; exit 1; }; \
        cargo deny check; \
    else echo "no Cargo.toml at repo root; nothing to deny-check"; fi

# Generate the tier-0 hygiene grade report (audit_scorecard.json).
# Stack-agnostic: prints the committed scorecard summary if present,
# otherwise reminds the operator to run the upstream grader.
grade:
    @if [ -f audit_scorecard.json ]; then \
        echo "Tier-0 grade summary ($(basename "$PWD")):"; \
        jq -r '"  overall: \(.overall)\n  grade:    \(.grade)\n  top wins:\n\(.scores | to_entries | sort_by(-.value) | .[0:5] | map("    - \(.key): \(.value)") | join("\n"))"' audit_scorecard.json; \
    else \
        echo "audit_scorecard.json not found in repo root."; \
        echo "Run the upstream Phenotype grader, or: just audit && just deny && just lint && just test"; \
    fi
