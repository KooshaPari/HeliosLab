# HeliosLab consolidation traceability

The root [`FUNCTIONAL_REQUIREMENTS.md`](../../FUNCTIONAL_REQUIREMENTS.md) inventory and
[`functional-requirements-traceability.json`](functional-requirements-traceability.json)
are validated by the strict
[`requirement-traceability.mjs`](../../tools/gates/requirement-traceability.mjs) gate.
Inventory completeness and verification status are independent: a complete mapping does not
turn an unchecked requirement green.

| Status | Requirement | Code | Tests | Evidence |
| --- | --- | --- | --- | --- |
| [x] | Complete root inventory mapping and artifact-path validation | `FUNCTIONAL_REQUIREMENTS.md`; `docs/reference/functional-requirements-traceability.json` | `tools/gates/trace-document-consistency.test.mjs`; `tools/gates/requirement-traceability.test.mjs` | 292 root requirements; 292 unique matrix rows; 0 missing mappings; 0 unknown mappings; 0 missing artifact paths |
| [ ] | Close strict requirement verification status | `docs/reference/functional-requirements-traceability.json` | `bun run traceability` | 176 checked; 116 unchecked; the gate remains a proper red until every row has checked code, test, and evidence |

Snapshot date: 2026-07-16. Counts are derived from the authoritative matrix, not from legacy
source-marker discovery reports. The gate resolves repository-relative paths from its own
location and fails closed on missing, unknown, duplicate, malformed, unchecked, or
missing-artifact mappings.
