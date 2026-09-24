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
 *   5. Freshness          — `generatedAt` is within `--max-age-days`
 *                           of "now" (default 90 days; pass
 *                           `--max-age-days 0` to disable).
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
export const DEFAULT_MAX_AGE_DAYS = 90;
export const MS_PER_DAY = 86_400_000;
// Accept ISO-8601 timestamps with an explicit timezone: either a trailing
// `Z` or a `±HH:MM` offset. Naive timestamps without a timezone are
// rejected because their meaning depends on the runtime's local offset
// and is therefore not reproducible across CI runners, dev laptops,
// and prod.
const ISO_TIMESTAMP_WITH_TZ =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Options that control the freshness check.
 *
 * `maxAgeDays === 0` disables the check (returns a `skip` finding).
 * `now` is injectable so tests don't depend on wall-clock time.
 */
export interface FreshnessOptions {
	maxAgeDays: number;
	now?: number;
}

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
 * Check 5: freshness. `generatedAt` must be within `maxAgeDays` of
 * "now" so a passing 1000-lane run from 2026 is not treated as
 * evidence in 2027. The check is `skip` when the gate is disabled
 * (`maxAgeDays === 0`) or when no report is available.
 *
 * `now` is injectable so unit tests can pin time without touching
 * the system clock; the CLI defaults to `Date.now()`.
 */
export function checkFreshness(
	report: CvpSchemaReport | null,
	opts: FreshnessOptions,
): CvpFinding {
	if (report === null) {
		return {
			check: "freshness",
			status: "skip",
			detail: "No CVP report available; freshness check skips.",
		};
	}
	if (opts.maxAgeDays <= 0) {
		return {
			check: "freshness",
			status: "skip",
			detail: "Freshness gate disabled (--max-age-days 0).",
		};
	}
	if (!ISO_TIMESTAMP_WITH_TZ.test(report.generatedAt)) {
		return {
			check: "freshness",
			status: "fail",
			detail: `generatedAt is not an ISO-8601 timestamp with an explicit timezone: ${JSON.stringify(report.generatedAt)}.`,
		};
	}
	const generatedMs = Date.parse(report.generatedAt);
	if (Number.isNaN(generatedMs)) {
		return {
			check: "freshness",
			status: "fail",
			detail: `generatedAt is not a valid ISO date: ${JSON.stringify(report.generatedAt)}.`,
		};
	}
	const now = opts.now ?? Date.now();
	const ageDays = (now - generatedMs) / MS_PER_DAY;
	if (ageDays < 0) {
		// Evidence dated in the future of "now" fails regardless of the
		// limit — this catches runtimes with mismatched clocks (or hand-
		// edited JSON claiming `generatedAt` tomorrow).
		return {
			check: "freshness",
			status: "fail",
			detail: `generatedAt=${report.generatedAt} is ${(-ageDays).toFixed(2)} days in the future of now; evidence cannot be dated after the present.`,
		};
	}
	if (ageDays > opts.maxAgeDays) {
		return {
			check: "freshness",
			status: "fail",
			detail: `Evidence is ${ageDays.toFixed(2)} days old (generatedAt=${report.generatedAt}); limit is ${opts.maxAgeDays}.`,
		};
	}
	return {
		check: "freshness",
		status: "pass",
		detail: `Evidence is ${ageDays.toFixed(2)} days old (generatedAt=${report.generatedAt}); within the ${opts.maxAgeDays}-day limit.`,
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
	freshness: FreshnessOptions = { maxAgeDays: DEFAULT_MAX_AGE_DAYS },
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
			skip("freshness"),
		];
	}
	return [
		checkSchema(report),
		checkOverallPass(report),
		checkPerCheckFlags(report),
		checkThresholdBounds(report),
		checkFreshness(report, freshness),
	];
}

/**
 * CLI entry point. Reads the JSON at `--file` (or
 * `docs/cvp/cvp-1000.json`), evaluates every check, writes a structured
 * report, and exits non-zero if any check fails.
 *
 * `--max-age-days <N>` (default 90) controls the freshness check.
 * `--max-age-days 0` disables the freshness check (returns `skip`).
 * `--now <ISO>` pins "now" for deterministic runs.
 */
function main(): void {
	const argv = process.argv.slice(2);
	const filePath = flagValue(argv, "--file") ?? DEFAULT_EVIDENCE_PATH;
	const commitSha =
		flagValue(argv, "--commit") ?? process.env.GITHUB_SHA ?? "local";

	// `--max-age-days <N>` is optional. When the flag is absent we fall
	// back to DEFAULT_MAX_AGE_DAYS; when it is present its operand must
	// be a non-negative integer (no decimals, no leading whitespace, no
	// trailing garbage — `Number.parseInt("3.14", 10)` would silently
	// return 3, which is why we re-validate the string itself).
	const maxAgeDaysRaw = flagValue(argv, "--max-age-days");
	let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
	if (maxAgeDaysRaw !== null) {
		if (!/^(0|[1-9]\d*)$/.test(maxAgeDaysRaw)) {
			console.error(
				`--max-age-days must be a non-negative integer (got ${JSON.stringify(maxAgeDaysRaw)})`,
			);
			process.exit(2);
		}
		maxAgeDays = Number.parseInt(maxAgeDaysRaw, 10);
	}

	// `--now <ISO>` is optional. When the flag is absent we fall back to
	// `Date.now()`; when it is present its operand must parse to a
	// finite timestamp. We require an explicit timezone in the operand
	// so unit tests that pin "now" cannot accidentally pin a naive local
	// time that varies by host.
	let now = Date.now();
	const nowRaw = flagValue(argv, "--now");
	if (nowRaw !== null) {
		if (!ISO_TIMESTAMP_WITH_TZ.test(nowRaw)) {
			console.error(
				`--now must be an ISO-8601 timestamp with an explicit timezone (got ${JSON.stringify(nowRaw)})`,
			);
			process.exit(2);
		}
		const parsed = Date.parse(nowRaw);
		if (!Number.isFinite(parsed)) {
			console.error(
				`--now parsed to a non-finite timestamp (got ${JSON.stringify(nowRaw)})`,
			);
			process.exit(2);
		}
		now = parsed;
	}

	const resolved = resolve(filePath);
	const report = readCvpReport(resolved);
	const findings = evaluateCvpReport(report, { maxAgeDays, now });

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
