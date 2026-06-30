import { describe, it, expect } from "bun:test";
import { validateId } from "../src/validate.js";
import { generateId, type EntityType } from "../src/index.js";

// Traces to: FR-ID-006 (ID validation: prefix/format/charset), FR-ID-008 (URL/filename/JSON safe)

// FR-007: validateId
describe("validateId", () => {
	const entities: EntityType[] = [
		"workspace",
		"lane",
		"session",
		"terminal",
		"run",
		"correlation",
	];

	for (const entity of entities) {
		it(`validates generated ${entity} ID`, () => {
			const id = generateId(entity);
			const result = validateId(id);
			expect(result.valid).toBe(true);
			if (result.valid) expect(result.entityType).toBe(entity);
		});
	}

	// FR-008: Negative validation cases
	it("rejects empty string", () => {
		const r = validateId("");
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.reason).toBe("Empty input");
	});

	it("rejects missing separator", () => {
		const r = validateId("ws01HXYZ1234567890ABCDEFGHIJ");
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.reason).toBe("Missing separator");
	});

	it("rejects unknown prefix", () => {
		const r = validateId("xx_01HXYZ1234567890ABCDEFGHIJ");
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.reason).toContain("Unknown prefix");
	});

	it("rejects short body", () => {
		const r = validateId("ws_01HXYZ");
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.reason).toContain("Invalid body length");
	});

	it("rejects invalid characters (lowercase body)", () => {
		const r = validateId("ws_01hxyz1234567890abcdefghij");
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.reason).toContain("Invalid characters");
	});

	it("rejects body with excluded chars I, L, O, U", () => {
		const r = validateId("ws_ILOU0000000000000000000000");
		expect(r.valid).toBe(false);
	});

	it("handles multiple underscores (splits on first)", () => {
		// ws_ + 26 chars with an underscore embedded — body has underscore so invalid chars
		const r = validateId("ws_01HXYZ123456789_ABCDEFGHI");
		expect(r.valid).toBe(false);
	});

	// FR-009: Prefix boundary - 2-char and 3-char prefixes
	it("validates 2-char prefix (ws)", () => {
		const id = generateId("workspace");
		expect(validateId(id).valid).toBe(true);
	});

	it("validates 3-char prefix (cor)", () => {
		const id = generateId("correlation");
		expect(validateId(id).valid).toBe(true);
	});
});
