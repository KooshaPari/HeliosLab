# Mined patterns: kwality → Benchora

**Source:** [<REDACTED>/kwality](https://github.com/KooshaPari/kwality) (read-only mine, 2026-05-31)
**Status:** kwality is an archived LLM validation experiment. These are **research patterns** for Benchora FR traceability and DeepEval-style benchmarking — not a code port.

## Why this doc exists

kwality explored semantic test-quality evaluation (DeepEval), Playwright MCP browser testing, and Neo4j FR tracing. **Benchora** is the stated successor for FR validation and benchmarking. This doc routes kwality research into Benchora's design vocabulary.

## Borrow: successor migration table

kwality README migration path (canonical routing when agents ask for "kwality-like" features):

| Need                   | Successor            | Notes                                          |
| ---------------------- | -------------------- | ---------------------------------------------- |
| FR Traceability        | **Benchora**         | Production-grade FR coverage validation        |
| Test Quality           | **phenotype-shared** | Testing utilities and fixtures                 |
| Observability / graphs | **Tracera** + Neo4j  | Production observability with knowledge graphs |
| Browser Automation     | **Playwright MCP**   | Standalone MCP tool for browser testing        |
| LLM Evaluation         | **cheap-llm-mcp**    | Model routing and cost-sensitive eval          |

**Adopt in Benchora:** link this table from Benchora README or ADR index as the tombstone entry for kwality FR-validation requests.

## Borrow: DeepEval evaluator plugin layout

kwality structure (reference):

```text
src/
  deepeval_client.py      # DeepEval harness entry
  evaluators/             # Custom metric plugins
prompts/                    # LLM prompt templates for evaluators
tests/test_validation.py  # Meta-tests for eval quality
```

Design pattern:

1. **One evaluator module per metric** (comprehensiveness, semantic coverage, assertion quality).
2. **Prompt templates separated** from runner code — version prompts independently.
3. **Meta-tests** validate evaluator stability (golden inputs → expected score bands).

**Adopt in Benchora:** when adding LLM-assisted FR checks, mirror `evaluators/` + `prompts/` split. Benchora property/contract tests remain deterministic; DeepEval-style plugins are optional **semantic layers** on top of FR specs.

## Borrow: semantic test-quality insights

kwality research outputs (from README):

- LLMs can assess test quality **beyond line coverage** (comprehensiveness, edge-case gaps).
- Graph-based FR traceability outperforms string matching for coverage-gap analysis.
- Playwright-as-MCP is viable for agent-driven UI validation.

**Adopt in Benchora:** document these as research citations in Benchora SOTA/SPEC when describing why FR validation uses structured specs + optional LLM review — not as runtime dependencies.

## Borrow: docker-compose eval stack (simplified)

kwality shipped aspirational multi-service compose (DeepEval + Neo4j + Playwright MCP + nginx). For Benchora dev:

- **Keep:** single-process Rust test runner as primary.
- **Optional sidecar:** Neo4j only when exercising FR graph queries (delegate to Tracera).
- **Do not replicate:** full kwality production stack — overkill per kwality's own archival rationale.

## Do not borrow

- kwality `engines/runtime-validator` as a fork — Benchora owns validation runtime.
- Standalone FastAPI eval server — use Benchora CLI + CI gates.
- Full Neo4j schema — see Tracera mined doc for graph query patterns.

## Related fork-lane repos

| Repo               | Role                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tracera            | Neo4j FR graph queries and traceability — [mined doc](https://github.com/KooshaPari/Tracera/blob/main/docs/research/mined-kwality-neo4j-fr-tracing.md) |
| phenotype-journeys | Journey evidence complements semantic test eval                                                                                                        |

## Provenance

Read-only mine of [kwality](https://github.com/KooshaPari/kwality) README and documented structure on 2026-05-31. kwality repo preserved read-only; no code copied.
