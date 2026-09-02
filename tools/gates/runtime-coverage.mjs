import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

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
	});

	process.stdout.write(run.stdout ?? "");
	process.stderr.write(run.stderr ?? "");

	if (run.status !== 0) {
		fail(`test command exited with code ${run.status ?? 1}`);
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
