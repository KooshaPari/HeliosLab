# HeliosLab consolidation traceability

`[x]` means every requirement, code, test, and evidence path exists and the focused gate test
passes. `[ ]` is a proper red: incomplete or unverified work must remain unchecked with its
missing evidence stated explicitly.

| Status | Requirement | Code | Tests | Evidence |
| --- | --- | --- | --- | --- |
| [x] | WP07 T035–T036 traceability gate | `tools/gates/requirement-traceability.mjs` | `tools/gates/requirement-traceability.test.mjs` | `node --test tools/gates/requirement-traceability.test.mjs` |
| [ ] | Consolidate the full HeliosLab FR inventory into the typed matrix | `docs/specs/001-colab-agent-terminal-control-plane/traceability-matrix.json` still uses the legacy `artifacts` shape | No complete matrix test exists | The default gate remains red until every root requirement has checked code, test, and evidence paths |

The gate resolves repository-relative paths from its own location, not the caller's current
directory or the checkout's ability to materialize Unix symlinks.
