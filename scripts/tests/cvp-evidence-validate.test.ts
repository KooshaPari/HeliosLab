import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CvpSchemaReport,
	checkFreshness,
	checkOverallPass,
	checkPerCheckFlags,
	checkSchema,
	checkThresholdBounds,
	DEFAULT_EVIDENCE_PATH,
	DEFAULT_MAX_AGE_DAYS,
	EXPECTED_COUNT,
	EXPECTED_SCHEMA,
	evaluateCvpReport,
	MS_PER_DAY,
	PASS_KEYS,
	REPORT_PATH,
	readCvpReport,
} from "../cvp-evidence-validate";

/**
 * Tests for the cvp-evidence validator. Exercises every check with
 * fixture reports so the same logic the workflow relies on is verified
 * without spinning up the heavy CVP harness.
 *
 * All calls to `evaluateCvpReport` and `checkFreshness` pass an
 * explicit `now` to keep the suite deterministic regardless of when
 * the test is run.
 */

const PASS_GENERATED_AT = "2026-09-20T00:00:00.000Z";
const PASS_NOW = Date.parse("2026-09-20T12:00:00.000Z"); // 12 hours after generatedAt
const PASS_FRESHNESS = { maxAgeDays: 90, now: PASS_NOW };

const PASSING_FIXTURE: CvpSchemaReport = {
	schema: "helios.cvp.v1",
	generatedAt: PASS_GENERATED_AT,
	options: { count: 1000, maxPtys: 1500, shell: null },
	results: {
		lanesRequested: 1000,
		lanesBound: 1000,
		lanesFailed: 0,
		spawnErrors: [],
		throughputLanesPerSecond: 12.5,
	},
	latency: {
		perLaneMs: {
			count: 1000,
			min_ms: 1000,
			p50_ms: 1200,
			p95_ms: 1400,
			p99_ms: 1500,
			max_ms: 1800,
			mean_ms: 1250,
		},
		cleanupMs: 500,
	},
	duration: {
		totalMs: 60_000,
		setupMs: 5,
		spawnAndBindMs: 55_000,
	},
	memory: {
		baselineRssBytes: 50_000_000,
		peakRssBytes: 120_000_000,
		afterCleanupRssBytes: 115_000_000,
		deltaBytes: 65_000_000,
		deltaMegabytes: 62,
	},
	thresholds: {
		maxTotalMs: 210_000,
		maxSpawnP99Ms: 150_000,
		maxCleanupMs: 25_000,
		maxMemoryDeltaMb: 200,
	},
	pass: {
		lanesBound: true,
		totalDuration: true,
		spawnLatency: true,
		cleanupLatency: true,
		memoryStability: true,
	},
	overallPass: true,
};

const FAILING_FIXTURE: CvpSchemaReport = {
	...PASSING_FIXTURE,
	options: { ...PASSING_FIXTURE.options, count: 25 },
	results: {
		...PASSING_FIXTURE.results,
		lanesRequested: 25,
		lanesBound: 24,
		lanesFailed: 1,
	},
	latency: {
		...PASSING_FIXTURE.latency,
		perLaneMs: {
			...PASSING_FIXTURE.latency.perLaneMs,
			p99_ms: 200_000,
		},
		cleanupMs: 30_000,
	},
	duration: {
		...PASSING_FIXTURE.duration,
		totalMs: 250_000,
	},
	memory: {
		...PASSING_FIXTURE.memory,
		deltaMegabytes: 250,
	},
	pass: {
		lanesBound: false,
		totalDuration: false,
		spawnLatency: false,
		cleanupLatency: false,
		memoryStability: false,
	},
	overallPass: false,
};

describe("readCvpReport", () => {
	test("returns parsed report when file exists and is valid JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "cvp-"));
		const path = join(dir, "cvp.json");
		writeFileSync(path, JSON.stringify(PASSING_FIXTURE));
		expect(readCvpReport(path)).toEqual(PASSING_FIXTURE);
		rmSync(dir, { recursive: true, force: true });
	});

	test("returns null when file does not exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "cvp-"));
		expect(readCvpReport(join(dir, "missing"))).toBeNull();
		rmSync(dir, { recursive: true, force: true });
	});

	test("returns null on invalid JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "cvp-"));
		const path = join(dir, "cvp.json");
		writeFileSync(path, "{ not json");
		expect(readCvpReport(path)).toBeNull();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("checkSchema", () => {
	test("passes when schema is the expected version", () => {
		expect(checkSchema(PASSING_FIXTURE).status).toBe("pass");
	});

	test("fails on wrong schema", () => {
		const wrong = { ...PASSING_FIXTURE, schema: "helios.cvp.v2" as never };
		const f = checkSchema(wrong);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("Unexpected schema");
	});

	test("skips on null report", () => {
		const f = checkSchema(null);
		expect(f.status).toBe("skip");
		expect(f.detail).toContain("No CVP evidence file present");
	});
});

describe("checkOverallPass", () => {
	test("passes when overallPass is true", () => {
		expect(checkOverallPass(PASSING_FIXTURE).status).toBe("pass");
	});

	test("fails when overallPass is false", () => {
		const r = { ...PASSING_FIXTURE, overallPass: false };
		const f = checkOverallPass(r);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("expected true");
	});
});

describe("checkPerCheckFlags", () => {
	test("passes when all pass flags are true", () => {
		expect(checkPerCheckFlags(PASSING_FIXTURE).status).toBe("pass");
	});

	test("fails when any single pass flag is false", () => {
		const r = {
			...PASSING_FIXTURE,
			pass: { ...PASSING_FIXTURE.pass, memoryStability: false },
		};
		const f = checkPerCheckFlags(r);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("memoryStability");
	});

	test("fails with every flag listed when all are false", () => {
		const allFalse = Object.fromEntries(
			PASS_KEYS.map((k) => [k, false]),
		) as Record<(typeof PASS_KEYS)[number], boolean>;
		const r = { ...PASSING_FIXTURE, pass: allFalse };
		const f = checkPerCheckFlags(r);
		expect(f.status).toBe("fail");
		for (const k of PASS_KEYS) {
			expect(f.detail).toContain(k);
		}
	});
});

describe("checkThresholdBounds", () => {
	test("passes when every measurement is within bounds", () => {
		expect(checkThresholdBounds(PASSING_FIXTURE).status).toBe("pass");
	});

	test("fails when lanes bound is fewer than requested", () => {
		const r = {
			...PASSING_FIXTURE,
			results: { ...PASSING_FIXTURE.results, lanesBound: 999 },
		};
		const f = checkThresholdBounds(r);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("lanesBound");
		expect(f.detail).toContain("999/1000");
	});

	test("fails when spawn p99 exceeds its bound", () => {
		const r = {
			...PASSING_FIXTURE,
			latency: {
				...PASSING_FIXTURE.latency,
				perLaneMs: { ...PASSING_FIXTURE.latency.perLaneMs, p99_ms: 999_999 },
			},
		};
		const f = checkThresholdBounds(r);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("spawn p99");
	});

	test("fails when cleanup latency exceeds its bound", () => {
		const r = {
			...PASSING_FIXTURE,
			latency: { ...PASSING_FIXTURE.latency, cleanupMs: 999_999 },
		};
		const f = checkThresholdBounds(r);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("cleanupMs");
	});

	test("fails when memory delta exceeds its bound", () => {
		const r = {
			...PASSING_FIXTURE,
			memory: { ...PASSING_FIXTURE.memory, deltaMegabytes: 999 },
		};
		const f = checkThresholdBounds(r);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("memory delta MB");
	});

	test("fails when total duration exceeds its bound", () => {
		const r = {
			...PASSING_FIXTURE,
			duration: { ...PASSING_FIXTURE.duration, totalMs: 999_999 },
		};
		const f = checkThresholdBounds(r);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("totalMs");
	});
});

describe("checkFreshness", () => {
	test("passes when evidence is well within the limit", () => {
		const f = checkFreshness(PASSING_FIXTURE, PASS_FRESHNESS);
		expect(f.status).toBe("pass");
		expect(f.detail).toContain("within the 90-day limit");
	});

	test("passes at the exact boundary (generatedAt + maxAgeDays)", () => {
		const f = checkFreshness(PASSING_FIXTURE, {
			maxAgeDays: 1,
			now: Date.parse(PASS_GENERATED_AT) + 1 * MS_PER_DAY,
		});
		expect(f.status).toBe("pass");
	});

	test("fails when evidence is just past the boundary", () => {
		const f = checkFreshness(PASSING_FIXTURE, {
			maxAgeDays: 1,
			now: Date.parse(PASS_GENERATED_AT) + 1 * MS_PER_DAY + 1000,
		});
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("limit is 1");
	});

	test("skips when maxAgeDays is 0 (gate explicitly disabled)", () => {
		const f = checkFreshness(PASSING_FIXTURE, {
			maxAgeDays: 0,
			now: PASS_NOW,
		});
		expect(f.status).toBe("skip");
		expect(f.detail).toContain("Freshness gate disabled");
	});

	test("skips on null report", () => {
		const f = checkFreshness(null, PASS_FRESHNESS);
		expect(f.status).toBe("skip");
		expect(f.detail).toContain("No CVP report available");
	});

	test("fails on unparseable generatedAt", () => {
		const r = { ...PASSING_FIXTURE, generatedAt: "not-an-iso-date" };
		const f = checkFreshness(r, PASS_FRESHNESS);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("explicit timezone");
	});

	test("fails on naive generatedAt (missing timezone)", () => {
		// 2026-09-20T00:00:00 is a valid instant without a timezone
		// marker. Different runtimes interpret it differently (UTC vs
		// local), so the freshness gate refuses to guess.
		const r = { ...PASSING_FIXTURE, generatedAt: "2026-09-20T00:00:00" };
		const f = checkFreshness(r, PASS_FRESHNESS);
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("explicit timezone");
	});

	test("fails when generatedAt is in the future of now", () => {
		// Use a future-tense timestamp relative to a fixed "now". This
		// catches runtimes with mismatched clocks (and any hand-edited
		// JSON claiming evidence was generated tomorrow).
		const now = Date.parse("2026-09-20T12:00:00.000Z");
		const r = { ...PASSING_FIXTURE, generatedAt: "2027-01-01T00:00:00.000Z" };
		const f = checkFreshness(r, { maxAgeDays: 90, now });
		expect(f.status).toBe("fail");
		expect(f.detail).toContain("in the future");
	});

	test("passes for offset timestamps (not just Z)", () => {
		const r = {
			...PASSING_FIXTURE,
			generatedAt: "2026-09-20T08:00:00-04:00", // 12:00 UTC
		};
		const f = checkFreshness(r, PASS_FRESHNESS);
		expect(f.status).toBe("pass");
	});
});

describe("evaluateCvpReport", () => {
	test("returns five pass findings for the passing fixture", () => {
		const findings = evaluateCvpReport(PASSING_FIXTURE, PASS_FRESHNESS);
		expect(findings).toHaveLength(5);
		for (const f of findings) {
			expect(f.status).toBe("pass");
		}
	});

	test("returns fail findings for every broken check in the failing fixture", () => {
		const findings = evaluateCvpReport(FAILING_FIXTURE, PASS_FRESHNESS);
		expect(findings).toHaveLength(5);
		const failCount = findings.filter((f) => f.status === "fail").length;
		expect(failCount).toBeGreaterThan(0);
	});

	test("returns five skip findings when report is null", () => {
		const findings = evaluateCvpReport(null, PASS_FRESHNESS);
		expect(findings).toHaveLength(5);
		for (const f of findings) {
			expect(f.status).toBe("skip");
		}
	});

	test("defaults freshness to DEFAULT_MAX_AGE_DAYS and fails on a stale report", () => {
		// generatedAt is six years old; with the default 90-day window
		// the freshness finding must be a fail without the caller
		// having to pass any options.
		const r = { ...PASSING_FIXTURE, generatedAt: "2020-01-01T00:00:00.000Z" };
		const findings = evaluateCvpReport(r);
		expect(findings).toHaveLength(5);
		const freshness = findings.find((f) => f.check === "freshness");
		expect(freshness).toBeDefined();
		expect(freshness?.status).toBe("fail");
		expect(freshness?.detail).toContain("limit is 90");
	});
});

describe("module exports", () => {
	test("exports the expected schema, count, and freshness constants", () => {
		expect(EXPECTED_SCHEMA).toBe("helios.cvp.v1");
		expect(EXPECTED_COUNT).toBe(1000);
		expect(DEFAULT_EVIDENCE_PATH).toBe("docs/cvp/cvp-1000.json");
		expect(REPORT_PATH).toBe(".gate-reports/cvp-evidence.json");
		expect(DEFAULT_MAX_AGE_DAYS).toBe(90);
		expect(MS_PER_DAY).toBe(86_400_000);
	});
});
