# Traceability

> **Historical discovery metric (not the strict traceability gate).** The example component
> below is not the repository requirement inventory. Current status is defined by
> [`functional-requirements-traceability.json`](../reference/functional-requirements-traceability.json)
> and validated by
> [`requirement-traceability.mjs`](../../tools/gates/requirement-traceability.mjs).

<TraceabilityMatrix
  :features="[{ id: 'REQ-001', name: 'Core', tests: ['test_core'], code: ['src/lib.rs'], coverage: 90 }]"
/>

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-001 | Core API | ✅ Implemented |
| REQ-002 | Config | ✅ Implemented |

<TestCoverageBadge :overall="90" :unit="95" />
