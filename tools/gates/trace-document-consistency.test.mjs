import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { extractRequirementIds, validateTraceability } from "./requirement-traceability.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const matrixPath = "docs/reference/functional-requirements-traceability.json";
const specPath = "FUNCTIONAL_REQUIREMENTS.md";

function read(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

test("trace documents report the strict matrix state without legacy claims", () => {
  const spec = read(specPath);
  const matrix = JSON.parse(read(matrixPath));
  const rows = matrix.requirements;
  const ids = rows.map(({ id }) => id);
  const checked = rows.filter(({ status }) => status === "[x]");
  const unchecked = rows.filter(({ status }) => status === "[ ]");
  const rootIds = extractRequirementIds(spec);
  const errors = validateTraceability({ specPath, matrixPath, repoRoot });

  assert.deepEqual(Object.keys(matrix), ["requirements"]);
  assert.equal(rows.length, 292);
  assert.equal(new Set(ids).size, 292);
  assert.equal(rootIds.length, 292);
  assert.deepEqual(new Set(ids), new Set(rootIds));
  assert.equal(checked.length, 176);
  assert.equal(unchecked.length, 116);
  assert.equal(errors.length, 116);
  assert.ok(errors.every(error => error.endsWith(" is unchecked")));

  const consolidation = read("docs/reference/HELIOSLAB_CONSOLIDATION_TRACEABILITY.md");
  const gaps = read("docs/reference/FR_TRACEABILITY_GAPS.md");
  const currentDocs = [spec, consolidation, gaps].join("\n");

  assert.match(spec, /\*\*Total Functional Requirements\*\*: 292/);
  assert.match(consolidation, /\| \[x\] \| Complete root inventory mapping/);
  assert.match(consolidation, /292 root requirements; 292 unique matrix rows/);
  assert.match(consolidation, /0 missing mappings; 0 unknown mappings/);
  assert.match(consolidation, /\| \[ \] \| Close strict requirement verification status/);
  assert.match(consolidation, /176 checked; 116 unchecked/);
  assert.match(gaps, /\*\*Strict status:\*\* 176\/292 checked; 116\/292 unchecked/);
  assert.doesNotMatch(currentDocs, /283\/293|remaining 10 untraced|96% traced/);
  assert.doesNotMatch(currentDocs, /292 requirements without root mappings|16 unknown/);
  assert.doesNotMatch(currentDocs, /specs\/025-provider-adapter-lifecycle\.md/);

  const historicalSurfaces = [
    "TEST_COVERAGE_MATRIX.md",
    "docs/reference/FR_COVERAGE_DASHBOARD.md",
    "docs/reference/fr_coverage_matrix.md",
    "docs/reference/FR_TRACKER.md",
    "docs/reference/CODE_ENTITY_MAP.md",
    "docs/traceability/index.md",
    "docs/specs/TRACEABILITY.md",
  ];
  for (const path of historicalSurfaces) {
    const document = read(path);
    assert.match(
      document,
      /Historical discovery metric \(not the strict traceability gate\)/,
      `${path} must identify its metric as historical`
    );
    assert.match(
      document,
      /functional-requirements-traceability\.json/,
      `${path} must link the authoritative matrix`
    );
    assert.match(document, /requirement-traceability\.mjs/, `${path} must link the strict gate`);
  }
});
