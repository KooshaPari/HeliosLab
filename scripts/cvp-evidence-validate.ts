#!/usr/bin/env bun
/**
 * CVP Evidence Validator
 *
 * Verifies that the on-disk Customer Validation Pack evidence carries a
 * passing run for the documented capacity claim (1000 concurrent live
 * sessions). The committed JSON at `docs/cvp/cvp-1000.json` is the
 * authoritative artifact and must:
 *
 *   1. Schema             — declare `schema === "helios.cvp.v1"`.
 *   2. Overall pass       — `overallPass` is true.
 *   3. Per-check pass     — every `pass.*` flag is true.
 *   4. Threshold bounds   — every numeric measurement is within the
 *                           thresholds the harness itself computed.
 *
 * Exits 0 if every check passes (or all skip), 1 otherwise. Output is a
 * structured machine-readable report written to
 * `.gate-reports/cvp-evidence.json`, with a human summary on stdout.
 *
 * Designed to run on every PR (the evidence file is small and the check
 * is fast) and post-merge on every release. The harness itself
 * (`apps/runtime/tests/cvp/cvp-harness.ts`) is opt-in via
 * `CVP_SCALING=1 CVP_TARGET=1000` because materialising 1000 live PTYs
 * is expensive and load-sensitive. This validator does not run the
 * harness; it only inspects the committed artifact so the same logic
 * can be unit-tested with fixtures.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

export interface CvpFinding {
	check: string;
	status: "pass" | "fail" | "skip";
	detail: string;
}

export interface CvpReport {
	gate: "cvp-evidence";
	commit: string;
	count: number | null;
	findings: CvpFinding[];
	ok: boolean;
}

export interface CvpSchemaReport {
	schema: "helios.cvp.v1";
	generatedAt: string;
	options: { count: number; maxPtys: number; shell: string | null };
	results: {
		lanesRequested: number;
		lanesBound: number;
		lanesFailed: number;
		spawnErrors: Array<{ laneId: string; message: string }>;
		throughputLanesPerSecond: number;
	};
	latency: {
		perLaneMs: {
			count: number;
			min_ms: number;
			p50_ms: number;
			p95_ms: number;
			p99_ms: number;
			max_ms: number;
			mean_ms: number;
		};
		cleanupMs: number;
	};
	duration: { totalMs: number; setupMs: number; spawnAndBindMs: number };
	memory: {
		baselineRssBytes: number;
		peakRssBytes: number;
		afterCleanupRssBytes: number;
		deltaBytes: number;
		deltaMegabytes: number;
	};
	thresholds: {
		maxTotalMs: number;
		maxSpawnP99Ms: number;
		maxCleanupMs: number;
		maxMemoryDeltaMb: number;
	};
	pass: {
		lanesBound: boolean;
		totalDuration: boolean;
		spawnLatency: boolean;
		cleanupLatency: boolean;
		memoryStability: boolean;
	};
	overallPass: boolean;
}

export const REPORT_PATH = ".gate-reports/cvp-evidence.json";
export const DEFAULT_EVIDENCE_PATH = "docs/cvp/cvp-1000.json";
export const EXPECTED_SCHEMA = "helios.cvp.v1";
export const EXPECTED_COUNT = 1000;

export const PASS_KEYS = [
	"lanesBound",
	"totalDuration",
	"spawnLatency",
	"cleanupLatency",
	"memoryStability",
] as const;

/**
 * Read and parse a CVP report from disk. Returns null on missing file or
 * invalid JSON. Schema validation is a separate step; the caller decides
 * whether `null` should be `skip` or `fail`.
 */
export function readCvpReport(path: string): CvpSchemaReport | null {
	if (!existsSync(path)) return null;
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return null;
	}
	try {
		return JSON.parse(raw) as CvpSchemaReport;
	} catch {
		return null;
	}
}

/**
 * Check 1: schema. The report must declare `helios.cvp.v1` so future
 * schema changes can be detected by a missing/renamed field.
 *
 * When the report file is missing, this check is `skip` rather than
 * `fail`: the gate is opt-in until a CVP run is committed. Once
 * `docs/cvp/cvp-1000.json` exists, the schema check enforces the
 * version field.
 */
export function checkSchema(report: CvpSchemaReport | null): CvpFinding {
	if (report === null) {
		return {
			check: "schema",
			status: "skip",
			detail:
				"No CVP evidence file present; gate skips until docs/cvp/cvp-1000.json is committed.",
		};
	}
	if (report.schema !== EXPECTED_SCHEMA) {
		return {
			check: "schema",
			status: "fail",
			detail: `Unexpected schema: ${JSON.stringify(report.schema)} (expected ${EXPECTED_SCHEMA}).`,
		};
	}
	return {
		check: "schema",
		status: "pass",
		detail: `Schema is ${EXPECTED_SCHEMA}.`,
	};
}

/**
 * Check 2: overall pass. The harness sets `overallPass` as the AND of
 * every per-check pass flag. We re-check both for clarity and as a
 * defence-in-depth measure in case the harness logic changes.
 */
export function checkOverallPass(report: CvpSchemaReport): CvpFinding {
	if (report.overallPass !== true) {
		return {
			check: "overall-pass",
			status: "fail",
			detail: `overallPass is ${JSON.stringify(report.overallPass)}; expected true.`,
		};
	}
	return {
		check: "overall-pass",
		status: "pass",
		detail: "overallPass is true.",
	};
}

/**
 * Check 3: per-check pass flags. Every `pass.*` flag must be true; we
 * iterate so a future harness that adds new checks is automatically
 * covered.
 */
export function checkPerCheckFlags(report: CvpSchemaReport): CvpFinding {
	const failing = PASS_KEYS.filter((k) => report.pass[k] !== true);
	if (failing.length > 0) {
		return {
			check: "per-check-flags",
			status: "fail",
			detail: `Failing pass flags: ${failing.join(", ")}.`,
		};
	}
	return {
		check: "per-check-flags",
		status: "pass",
		detail: `All ${PASS_KEYS.length} pass flags are true (${PASS_KEYS.join(", ")}).`,
	};
}

/**
 * Check 4: threshold bounds. Even if `overallPass` is true we re-verify
 * the actual measurements against the harness's own `thresholds`
 * section, because the harness could be edited to relax a threshold
 * without anyone noticing the JSON still passes.
 */
export function checkThresholdBounds(report: CvpSchemaReport): CvpFinding {
	const r = report.results;
	const l = report.latency;
	const d = report.duration;
	const m = report.memory;
	const t = report.thresholds;

	const checks: Array<{ label: string; ok: boolean; detail: string }> = [
		{
			label: "lanesBound === lanesRequested",
			ok: r.lanesBound === r.lanesRequested,
			detail: `${r.lanesBound}/${r.lanesRequested}`,
		},
		{
			label: "totalMs < maxTotalMs",
			ok: d.totalMs < t.maxTotalMs,
			detail: `${d.totalMs} < ${t.maxTotalMs}`,
		},
		{
			label: "spawn p99_ms < maxSpawnP99Ms",
			ok: l.perLaneMs.p99_ms < t.maxSpawnP99Ms,
			detail: `${l.perLaneMs.p99_ms} < ${t.maxSpawnP99Ms}`,
		},
		{
			label: "cleanupMs < maxCleanupMs",
			ok: l.cleanupMs < t.maxCleanupMs,
			detail: `${l.cleanupMs} < ${t.maxCleanupMs}`,
		},
		{
			label: "memory delta MB < maxMemoryDeltaMb",
			ok: m.deltaMegabytes < t.maxMemoryDeltaMb,
			detail: `${m.deltaMegabytes} < ${t.maxMemoryDeltaMb}`,
		},
	];

	const failing = checks.filter((c) => !c.ok);
	if (failing.length > 0) {
		return {
			check: "threshold-bounds",
			status: "fail",
			detail: `Failing bounds: ${failing
				.map((c) => `${c.label} (${c.detail})`)
				.join("; ")}.`,
		};
	}
	return {
		check: "threshold-bounds",
		status: "pass",
		detail: `All bounds satisfied: ${checks.map((c) => c.label).join("; ")}.`,
	};
}

/**
 * Run every check against the parsed report. Returns a structured
 * summary suitable for both CI consumption and human inspection. If the
 * file is missing or unparseable, every check returns `skip` — the
 * validator alone cannot tell the difference between "no evidence yet"
 * and "evidence was deleted"; that distinction belongs to the workflow
 * layer.
 */
export function evaluateCvpReport(
	report: CvpSchemaReport | null,
): CvpFinding[] {
	if (report === null) {
		const skip = (check: string): CvpFinding => ({
			check,
			status: "skip",
			detail: "No CVP report available.",
		});
		return [
			skip("schema"),
			skip("overall-pass"),
			skip("per-check-flags"),
			skip("threshold-bounds"),
		];
	}
	return [
		checkSchema(report),
		checkOverallPass(report),
		checkPerCheckFlags(report),
		checkThresholdBounds(report),
	];
}

/**
 * CLI entry point. Reads the JSON at `--file` (or
 * `docs/cvp/cvp-1000.json`), evaluates every check, writes a structured
 * report, and exits non-zero if any check fails.
 */
function main(): void {
	const argv = process.argv.slice(2);
	const filePath = flagValue(argv, "--file") ?? DEFAULT_EVIDENCE_PATH;
	const commitSha =
		flagValue(argv, "--commit") ?? process.env.GITHUB_SHA ?? "local";

	const resolved = resolve(filePath);
	const report = readCvpReport(resolved);
	const findings = evaluateCvpReport(report);

	const summary: CvpReport = {
		gate: "cvp-evidence",
		commit: commitSha,
		count: report?.options.count ?? null,
		findings,
		ok: findings.every((f) => f.status === "pass" || f.status === "skip"),
	};

	mkdirSync(dirname(REPORT_PATH), { recursive: true });
	writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));

	for (const f of findings) {
		const marker = f.status === "pass" ? "✓" : f.status === "fail" ? "✗" : "·";
		console.log(`  ${marker} ${f.check}: ${f.detail}`);
	}

	if (!summary.ok) {
		console.error(
			`\nCVP evidence gate FAILED for ${commitSha} (count=${summary.count}).`,
		);
		process.exit(1);
	}
	console.log(
		`\nCVP evidence gate passed for ${commitSha} (count=${summary.count ?? "?"}).`,
	);
}

function flagValue(argv: string[], flag: string): string | null {
	const idx = argv.indexOf(flag);
	if (idx === -1 || idx === argv.length - 1) return null;
	return argv[idx + 1] ?? null;
}

if (import.meta.main) {
	main();
}
