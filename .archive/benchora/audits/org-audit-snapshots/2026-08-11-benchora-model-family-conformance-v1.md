# Snapshot: Benchora Model-Family Conformance Matrix v1 — 2026-08-11

## Summary

Anchors the v1 model-family conformance matrix produced by
`BACKLOG-OMLX-003` (commit `f0e020dc` on `phenotype-omlx-wtrees/
conformance-matrix`) inside Benchora's audit trail. The matrix is
the canonical reference for which model families Benchora's
benchmark + oracle tooling can vouch for, and which families still
require a V0→V1 promotion pass.

## Snapshot details

| Field | Value |
|---|---|
| Audit date (UTC) | 2026-08-11 |
| Auditor | `agent-droid-phenotype` (session-20260811) |
| Repo | `<REDACTED>/Benchora` (`bd8b717` branch tip) |
| Backlog ID | `BACKLOG-OMLX-003` |
| Source file | `phenotype-omlx/perf-core/eval-harness/conformance/README.md` (commit `f0e020dc`) |
| Coverage | 22 model families (attention 9, MoE 5, recurrent 4, diffusion 2, quantized 1, speculative 1) |

## What is in the v1 matrix

The v1 matrix enumerates 22 model families and assigns each one a
5-signal promotion gate of:

1. **Real model** — a real (not synthetic) representative exists on
   HuggingFace / GGUF / etc.
2. **Agentic trace** — at least one agentic trace has been run with
   the family (not just pre-training).
3. **NIAH oracle** — Needle-in-a-Haystack oracle passes at the
   configured reward (1.0) and within the ±20% wallclock budget
   (41s for 8k context, 114s for 32k context).
4. **Quality** — quality regression vs. a known-good reference is
   within the threshold (≤ 2% delta on the held-out eval set).
5. **Stability** — across 3 reruns, variance is ≤ 5%.

The matrix also documents the V0→V1→V2→G1 promotion thresholds:

| Stage | Criteria | Owner |
|---|---|---|
| V0 → V1 | 3 of 5 signals pass | Model integrators |
| V1 → V2 | 5 of 5 signals pass; quality variance < 1% | Senior reviewer |
| V2 → G1 | 30-day burn-in with no rollback; Fleet-wide rollout | Release manager |

## Coverage summary

| Family | Count | Notes |
|---|---|---|
| Attention | 9 | Classic transformer architectures (encoder, decoder, encoder-decoder) |
| MoE | 5 | Mixture-of-Experts variants (Top-2, switch, sparse) |
| Recurrent | 4 | RNN / RWKV / MambaSSM variants |
| Diffusion | 2 | Discrete and continuous diffusion |
| Quantized | 1 | Int4/Int8 quantized variants |
| Speculative | 1 | Draft-and-verify speculative decoding |
| **Total** | **22** | |

## Cross-references

- Benchora `audits/README.md` (canonical audit-dir contract)
- phenotype-omlx `conformance/README.md` (source of truth)
- BACKLOG-OMLX-002 (deferred — V1 model-family conformance
  implementation; this artifact is just the matrix template)
- BACKLOG-OMLX-003 (closed — matrix was authored on
  2026-08-11)
- BACKLOG-OMLX-004 (deferred — Harbor preflight signed envelope)

## Supersedes

None.
