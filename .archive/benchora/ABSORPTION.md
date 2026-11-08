# Absorption Manifest — Benchora

**Status:** folded into HeliosLab 2026-11-08. Benchora is **not** absorbed into PhenoShared — that remains a
decided-against action. It lives here as its own subtree.

- **Source:** `KooshaPari/PhenoTooling` (archived), path `Benchora/`
- **Source revision:** `2feccc2f5b12c77785dda7960f7c31d25baf4e54` (`origin/main`)
- **Files:** 138
- **Packages:** `benchora` (v0.2.1) and `Benchora-fuzz` (package name at `fuzz/Cargo.toml`)

## Why here

The canonical `KooshaPari/Benchora` GitHub repo no longer resolves, and a sweep of 196 org repos found no match.
Six local copies existed in three content variants; all six carried the same 138 paths and 134 unique blobs, so no
copy held an extra file. `PhenoTooling/Benchora` was the most complete by history (it uniquely held the stash commit
and the 2026-11-04 redaction commit), so it is the source used for this fold.

All six copies **also** denote a repo URL of `https://github.com/KooshaPari/Benchora`, i.e. the package metadata
still points at the repo that no longer resolves. That is worth fixing at the manifest level if this becomes live.

## Relationship to `src/helios_bench`

`src/helios_bench/` is a Python benchmarking harness. 7 of Benchora's 36 previously-unmatched source files were
byte-identical to files under it (`benchora_emitter.py` and friends), which is consistent with Benchora having been
extracted from a sharecli mirror rather than being a HeliosLab component.

The two are therefore **parallel**, not merged: `src/helios_bench/` stays the live Python harness, and `benchora/`
preserves the Rust crate and its benchmarks. Nothing was deduplicated, because the overlap was 7 files and
removing them would change behaviour in a repo that has no tests for them.

## What this does not do

- It does not build Benchora. `.archive/benchora/Cargo.toml` is not part of any HeliosLab workspace.
- It does not restore the upstream repo. If Benchora becomes live, it should get a real repo again.
