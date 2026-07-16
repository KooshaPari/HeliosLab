import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
	completeGateReports,
	createAggregationFailureReport,
	loadGateReports,
} from "../gate-aggregate";
import { createGateReport } from "../gate-report";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "helios-gate-aggregate-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("Gate report aggregation", () => {
	test("missing required gates become structured failures (FR-CI-011)", () => {
		const lint = createGateReport("lint", [], 12);

		const reports = completeGateReports([lint], ["lint", "test"]);

		expect(reports).toHaveLength(2);
		expect(reports[1]).toMatchObject({
			gateName: "test",
			status: "fail",
			findings: [
				{
					file: ".gate-reports/gate-test.json",
					message: "Required test gate report was not produced.",
					severity: "error",
				},
			],
		});
		expect(reports[1]?.findings[0]?.remediation).toBeTruthy();
	});

	test("duplicate gate reports fail closed", () => {
		const lint = createGateReport("lint", [], 12);

		expect(() => completeGateReports([lint, lint], ["lint"])).toThrow(
			"Duplicate gate report: lint",
		);
	});

	test("converts aggregation exceptions into structured failures (FR-CI-011)", () => {
		const report = createAggregationFailureReport(
			new Error("Failed to read report gate-lint.json"),
		);

		expect(report).toMatchObject({
			gateName: "aggregate",
			status: "fail",
			findings: [
				{
					file: ".gate-reports",
					message: "Failed to read report gate-lint.json",
					severity: "error",
					remediation:
						"Regenerate every gate report and correct malformed or missing report evidence.",
				},
			],
		});
	});

	test("writes a structured artifact when aggregation fails", () => {
		const directory = createTemporaryDirectory();
		const script = join(import.meta.dir, "..", "gate-aggregate.ts");
		const result = Bun.spawnSync({
			cmd: [process.execPath, script],
			cwd: directory,
			stderr: "pipe",
			stdout: "pipe",
		});

		expect(result.exitCode).toBe(2);
		const report = JSON.parse(
			readFileSync(join(directory, ".gate-reports", "aggregation-error.json"), "utf8"),
		);
		expect(report).toMatchObject({ gateName: "aggregate", status: "fail" });
		expect(report.findings[0].remediation).toBeTruthy();
	});

	test("fails closed when the report directory is missing (FR-CI-011)", () => {
		const directory = createTemporaryDirectory();
		rmSync(directory, { recursive: true });

		expect(() => loadGateReports(directory)).toThrow("Gate report directory is missing");
	});

	test("fails closed when no gate reports were produced (FR-CI-011)", () => {
		const directory = createTemporaryDirectory();

		expect(() => loadGateReports(directory)).toThrow("No gate reports found");
	});

	test("fails closed instead of skipping a malformed report (FR-CI-011)", () => {
		const directory = createTemporaryDirectory();
		writeFileSync(join(directory, "gate-lint.json"), "{not-json");

		expect(() => loadGateReports(directory)).toThrow("gate-lint.json");
	});

	test("rejects valid JSON that does not match the report schema (FR-CI-011)", () => {
		const directory = createTemporaryDirectory();
		writeFileSync(
			join(directory, "gate-lint.json"),
			JSON.stringify({ gateName: "lint", status: "pass" }),
		);

		expect(() => loadGateReports(directory)).toThrow("gate-lint.json");
	});

	test("loads a valid structured report", () => {
		const directory = createTemporaryDirectory();
		const report = createGateReport("lint", [], 12);
		writeFileSync(join(directory, "gate-lint.json"), JSON.stringify(report));

		expect(loadGateReports(directory)).toEqual([report]);
	});
});
