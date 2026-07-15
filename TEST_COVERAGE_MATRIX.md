# Test Coverage Matrix

**Project**: heliosApp  
**Document Version**: 1.0  
**Last Updated**: 2026-04-02

---

## Coverage Summary

| Metric | Value |
|--------|-------|
| Functional Requirements | 283 |
| Test Files | 253 |
| Test Functions | 2451 |
| Coverage Target | 80% |
| Current Coverage | 61.5% traced (174 / 283 FRs; see `docs/reference/FR_COVERAGE_DASHBOARD.md`) |

---

## Test Categories

### Unit Tests
- **Location**: As appropriate for language (TypeScript)
- **Purpose**: Test individual components in isolation
- **Coverage Target**: 90%

### Integration Tests
- **Location**: tests/integration/
- **Purpose**: Test component interactions
- **Coverage Target**: 75%

---

## FR to Test Coverage Mapping

Detailed FR-to-test traceability is maintained in `docs/reference/fr_coverage_matrix.md`.

## Gate-verified requirement evidence

The strict traceability gate uses
`docs/reference/functional-requirements-traceability.json`. A requirement is marked
`[x]` there only when the repository contains implementation, executable tests, and
reviewable evidence. The broader inventory above is discovery data and does not imply
gate verification.

- [x] FR-ID-001 through FR-ID-004: typed prefixed ULIDs, canonical prefixes, ULID
  generation, and collision resistance are implemented and tested.
- [ ] FR-ID-005: the package is exportable, but use by every named external repository
  has not been proven here. `packages/ids/tests/package-export.test.ts` proves only
  that consumers can resolve and use the package's named public export; this mapping
  intentionally remains unchecked until all named repositories provide evidence.
- [x] FR-ID-006 through FR-ID-009: validation, parsing, safe serialization, and
  monotonic ordering are implemented and tested.
- [x] FR-BUS-001 and FR-BUS-003 through FR-BUS-009: the envelope contract, method
  and topic registries, per-topic ordering, fail-closed validation, error taxonomy,
  correlation propagation, and deterministic subscriber delivery are implemented
  and covered by focused unit and integration tests.
- [ ] FR-BUS-002 remains unchecked because the current protocol envelope ID prefixes
  have not yet been brought into parity with the spec 005 ID package.
- [x] `bun test packages/ids/tests` passes, including the 10-million-ID collision test.
- [x] `node --test tools/gates/requirement-traceability.test.mjs` proves fail-closed
  behavior for missing, unknown, duplicate, malformed, unchecked, and missing-artifact
  mappings.
- [ ] All requirements outside this verified slice remain proper-red until equivalent
  code, tests, and evidence are recorded.

---

## Coverage Gaps

See `docs/reference/FR_COVERAGE_DASHBOARD.md` for category-level gaps and status.

---

## Recommendations

### Immediate Actions
1. Add unit tests for domain types
2. Add integration tests for adapters

### Short-term Actions
1. Increase traced FR coverage toward 80%+

---

**Last Updated**: 2026-04-02
