import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { loadGateReports } from "../gate-aggregate";
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
