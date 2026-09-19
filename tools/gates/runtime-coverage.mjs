import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const threshold = Number(process.env.COVERAGE_MIN ?? "85");
const fixturePath = process.env.COVERAGE_REPORT_PATH;

function fail(message) {
	console.error(`Coverage gate failed: ${message}`);
	process.exit(1);
}

function parseLinesPercent(report) {
	const match = report.match(/All files\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)/);
	if (!match) {
		return null;
	}
	return Number(match[2]);
}

let reportText = "";
if (fixturePath) {
	reportText = readFileSync(fixturePath, "utf8");
} else {
	const run = spawnSync("bun", ["test", "apps/runtime/tests", "--coverage"], {
		encoding: "utf8",
		// spawnSync buffers the child's whole stdout and stderr in memory, and its
		// default maxBuffer is 1 MB. This suite emits well over that with coverage
		// output, so the child was being killed mid-write, run.status came back
		// null, and the gate below reported the misleading "test command exited
		// with code 1" even though no test had failed. Raised so a large but
		// healthy run is not mistaken for a failing one.
		maxBuffer: 256 * 1024 * 1024,
	});

	process.stdout.write(run.stdout ?? "");
	process.stderr.write(run.stderr ?? "");

	if (run.status === null) {
		// Distinguish "the child was killed" from "the tests failed". The old
		// message said "exited with code 1", which sent me looking for a broken
		// test when there was none.
		fail(
			`test command was terminated before it finished (signal ${run.signal ?? "unknown"}). ` +
				"Likely causes: output exceeded the buffer, or the runner killed it. " +
				"This is NOT a report that tests failed.",
		);
	}

	if (run.status !== 0) {
		fail(`test command exited with code ${run.status}`);
	}

	reportText = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
}

const linesPct = parseLinesPercent(reportText);
if (linesPct === null) {
	fail("unable to parse lines coverage from report output");
}

if (linesPct < threshold) {
	fail(
		`lines coverage ${linesPct.toFixed(2)}% is below required ${threshold}%`,
	);
}

console.log(
	`Coverage gate passed: lines coverage ${linesPct.toFixed(2)}% >= ${threshold}%.`,
);
