/**
 * FR-HELIOS-040: Quality Gates Fixtures Tests
 * Verifies: FR-CI-006 (Coverage threshold), FR-CI-009 (Gate-bypass detection)
 */
import { describe, expect, test } from "bun:test";

const TRACE_GATE = "tools/gates/requirement-traceability.mjs";
const COVERAGE_GATE = "tools/gates/runtime-coverage.mjs";

describe("quality gates fail-closed fixtures", () => {
  test("requirement traceability gate passes with complete fixture mapping", () => {
    const run = Bun.spawnSync(["node", TRACE_GATE], {
      env: {
        ...process.env,
        TRACE_SPEC_PATH: "tools/gates/fixtures/traceability/spec-fixture.md",
        TRACE_MATRIX_PATH: "tools/gates/fixtures/traceability/matrix-pass.json",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(run.exitCode).toBe(0);
  });

  test("requirement traceability gate fails closed when mappings are missing", () => {
    const run = Bun.spawnSync(["node", TRACE_GATE], {
      env: {
        ...process.env,
        TRACE_SPEC_PATH: "tools/gates/fixtures/traceability/spec-fixture.md",
        TRACE_MATRIX_PATH: "tools/gates/fixtures/traceability/matrix-missing.json",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(run.exitCode).toBe(1);
  });

  test("coverage gate passes at and above 85 percent", () => {
    const run = Bun.spawnSync(["node", COVERAGE_GATE], {
      env: {
        ...process.env,
        COVERAGE_REPORT_PATH: "tools/gates/fixtures/coverage-pass.txt",
        COVERAGE_MIN: "85",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(run.exitCode).toBe(0);
  });

  test("coverage gate fails closed below 85 percent", () => {
    const run = Bun.spawnSync(["node", COVERAGE_GATE], {
      env: {
        ...process.env,
        COVERAGE_REPORT_PATH: "tools/gates/fixtures/coverage-fail.txt",
        COVERAGE_MIN: "85",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(run.exitCode).toBe(1);
  });
});
