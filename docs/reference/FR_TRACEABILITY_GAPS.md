# HeliosLab strict traceability gaps

Snapshot date: 2026-07-16.

The authoritative status source is
[`functional-requirements-traceability.json`](functional-requirements-traceability.json),
validated against root [`FUNCTIONAL_REQUIREMENTS.md`](../../FUNCTIONAL_REQUIREMENTS.md) by
[`requirement-traceability.mjs`](../../tools/gates/requirement-traceability.mjs).

**Strict status:** 176/292 checked; 116/292 unchecked. All 292 root IDs have exactly one
matrix row. There are zero missing mappings, zero unknown mappings, and zero missing code,
test, or evidence paths. The 116 unchecked rows remain proper reds; path presence alone does
not justify changing their status.

## Strict status by category

| Category | Total | Checked | Unchecked |
| --- | ---: | ---: | ---: |
| APR | 11 | 7 | 4 |
| AUD | 11 | 11 | 0 |
| BND | 8 | 8 | 0 |
| BUS | 10 | 10 | 0 |
| CFG | 10 | 10 | 0 |
| CI | 11 | 5 | 6 |
| CRH | 10 | 4 | 6 |
| DEP | 8 | 5 | 3 |
| DIAG | 9 | 9 | 0 |
| ENG | 8 | 3 | 5 |
| GHT | 7 | 1 | 6 |
| ID | 9 | 8 | 1 |
| LAN | 8 | 8 | 0 |
| LST | 7 | 1 | 6 |
| MVP | 27 | 3 | 24 |
| ORF | 9 | 7 | 2 |
| PER | 10 | 9 | 1 |
| PRF | 10 | 7 | 3 |
| PTY | 8 | 8 | 0 |
| PVD | 12 | 3 | 9 |
| REV | 10 | 3 | 7 |
| RIO | 8 | 7 | 1 |
| RND | 8 | 8 | 0 |
| RUN | 8 | 5 | 3 |
| SEC | 11 | 11 | 0 |
| SHL | 10 | 0 | 10 |
| SHR | 11 | 0 | 11 |
| TAB | 7 | 6 | 1 |
| TXN | 8 | 3 | 5 |
| ZMX | 8 | 6 | 2 |
| **Total** | **292** | **176** | **116** |

## Closing a gap

Change an unchecked row only in the same change that supplies reviewable code, executable
tests, and evidence for that exact requirement. Then run the focused document contract and
the strict gate. Historical source-marker dashboards may help locate work, but they do not
override this matrix or the gate.
