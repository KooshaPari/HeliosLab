import { describe, it, expect } from "bun:test";
import {
	generateId,
	generateCorrelationId,
	type EntityType,
} from "../src/index.js";

const FORMAT_REGEX = /^[a-z]{2,3}_[0-9A-HJKMNP-TV-Z]{26}$/;

// Traces to: FR-ID-001 (typed ID format), FR-ID-002 (prefixes), FR-ID-003 (ULID body),
// FR-ID-004 (global uniqueness), FR-ID-005 (shared ID generation), FR-ID-009 (monotonic ordering)

// FR-004: generateId public API
describe("generateId", () => {
	const cases: [EntityType, string][] = [
		["workspace", "ws"],
		["lane", "ln"],
		["session", "ss"],
		["terminal", "tm"],
		["run", "rn"],
		["correlation", "cor"],
	];

	for (const [entity, prefix] of cases) {
		it(`generates correct format for ${entity} (prefix: ${prefix})`, () => {
			const id = generateId(entity);
			expect(id).toMatch(FORMAT_REGEX);
			expect(id.startsWith(`${prefix}_`)).toBe(true);
		});
	}

	// FR-005: Uniqueness
	it("generates 10,000 unique IDs", () => {
		const ids = new Set(
			Array.from({ length: 10_000 }, () => generateId("workspace")),
		);
		expect(ids.size).toBe(10_000);
	});
});

// FR-006: generateCorrelationId convenience
describe("generateCorrelationId", () => {
	it("returns cor_ prefix", () => {
		const id = generateCorrelationId();
		expect(id.startsWith("cor_")).toBe(true);
		expect(id).toMatch(FORMAT_REGEX);
	});

	it("generates unique correlation IDs", () => {
		const ids = new Set(
			Array.from({ length: 1000 }, () => generateCorrelationId()),
		);
		expect(ids.size).toBe(1000);
	});
});
