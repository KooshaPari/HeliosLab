#!/usr/bin/env bun
/**
 * Gate 5: Code coverage threshold enforcement
 * Parses coverage output and generates structured JSON report
 */

import { readFileSync, existsSync } from "fs";
import {
	createGateReport,
	writeGateReport,
	formatGateReport,
	type GateFinding,
} from "./gate-report";

const REPORT_OUTPUT = ".gate-reports/gate-coverage.json";
const COVERAGE_THRESHOLD = 85;

interface CoverageMetrics {
	lines: number;
	functions: number;
	branches: number;
	statements: number;
}

/**
 * Parse Vitest coverage-json output (coverage-final.json or coverage/coverage-final.json).
 */
function parseCoverageData(): {
	packages: Map<string, CoverageMetrics>;
	aggregate: CoverageMetrics;
} {
	const packages = new Map<string, CoverageMetrics>();

	const aggregate: CoverageMetrics = {
		lines: 0,
		functions: 0,
		branches: 0,
		statements: 0,
	};

	const candidatePaths = [
		"coverage/coverage-final.json",
		"coverage-final.json",
	];

	let coverageJson:
		| Record<
				string,
				{
					s: Record<string, number>;
					f: Record<string, number>;
					b: Record<string, number[]>;
					statementMap: Record<string, unknown>;
					fnMap: Record<string, unknown>;
					branchMap: Record<string, unknown>;
				}
		  >
		| undefined;

	for (const p of candidatePaths) {
		if (existsSync(p)) {
			try {
				coverageJson = JSON.parse(readFileSync(p, "utf-8"));
				break;
			} catch {
				// malformed JSON, skip
			}
		}
	}

	if (!coverageJson) {
		console.warn(
			"No coverage-final.json found. Run vitest with --coverage first.",
		);
		return { packages, aggregate };
	}

	// Group files by top-level package (apps/runtime, apps/desktop, packages/*)
	const pkgTotals = new Map<
		string,
		{
			covS: number;
			totS: number;
			covF: number;
			totF: number;
			covB: number;
			totB: number;
		}
	>();

	for (const [filePath, data] of Object.entries(coverageJson)) {
		const match = filePath.match(/^(?:\.\/)?((apps|packages)\/[^/]+)/);
		const pkgName = match ? match[1] : "root";

		if (!pkgTotals.has(pkgName)) {
			pkgTotals.set(pkgName, {
				covS: 0,
				totS: 0,
				covF: 0,
				totF: 0,
				covB: 0,
				totB: 0,
			});
		}
		const t = pkgTotals.get(pkgName)!;

		// Statements
		const stmts = Object.values(data.s);
		t.totS += stmts.length;
		t.covS += stmts.filter((v) => v > 0).length;

		// Functions
		const fns = Object.values(data.f);
		t.totF += fns.length;
		t.covF += fns.filter((v) => v > 0).length;

		// Branches
		const branches = Object.values(data.b).flat();
		t.totB += branches.length;
		t.covB += branches.filter((v) => v > 0).length;
	}

	let totalCovS = 0,
		totalTotS = 0,
		totalCovF = 0,
		totalTotF = 0,
		totalCovB = 0,
		totalTotB = 0;

	for (const [pkgName, t] of pkgTotals) {
		const pct = (covered: number, total: number) =>
			total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;
		const metrics: CoverageMetrics = {
			statements: pct(t.covS, t.totS),
			lines: pct(t.covS, t.totS), // lines ≈ statements for istanbul format
			functions: pct(t.covF, t.totF),
			branches: pct(t.covB, t.totB),
		};
		packages.set(pkgName, metrics);

		totalCovS += t.covS;
		totalTotS += t.totS;
		totalCovF += t.covF;
		totalTotF += t.totF;
		totalCovB += t.covB;
		totalTotB += t.totB;
	}

	const pct = (covered: number, total: number) =>
		total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;
	aggregate.statements = pct(totalCovS, totalTotS);
	aggregate.lines = pct(totalCovS, totalTotS);
	aggregate.functions = pct(totalCovF, totalTotF);
	aggregate.branches = pct(totalCovB, totalTotB);

	return { packages, aggregate };
}

/**
 * Generate findings for coverage violations.
 */
function checkCoverageThresholds(
	packages: Map<string, CoverageMetrics>,
	aggregate: CoverageMetrics,
): GateFinding[] {
	const findings: GateFinding[] = [];

	packages.forEach((metrics, pkgName) => {
		const metricsEntries = Object.entries(metrics) as Array<
			[keyof CoverageMetrics, number]
		>;
		metricsEntries.forEach(([metricName, value]) => {
			if (value < COVERAGE_THRESHOLD) {
				findings.push({
					file: pkgName,
					message: `Coverage for ${metricName} is ${value}%, below threshold of ${COVERAGE_THRESHOLD}%`,
					severity: "error",
					rule: `coverage-${metricName}`,
					remediation: `Add tests to increase ${metricName} coverage above ${COVERAGE_THRESHOLD}%`,
				});
			}
		});
	});

	return findings;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
	const startTime = Date.now();
	const { packages, aggregate } = parseCoverageData();
	const findings = checkCoverageThresholds(packages, aggregate);
	const duration = Date.now() - startTime;

	const report = createGateReport("coverage", findings, duration);
	writeGateReport(report, REPORT_OUTPUT);

	console.log(formatGateReport(report));

	if (packages.size > 0) {
		console.log("\nPer-Package Coverage:");
		packages.forEach((metrics, pkgName) => {
			console.log(`  ${pkgName}:`);
			Object.entries(metrics).forEach(([metric, value]) => {
				const status = value >= COVERAGE_THRESHOLD ? "✓" : "✗";
				console.log(`    ${status} ${metric}: ${value}%`);
			});
		});
	}

	process.exit(report.status === "pass" ? 0 : 1);
}

main().catch((e) => {
	console.error(`Error: ${e}`);
	process.exit(2);
});
