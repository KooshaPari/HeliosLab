import { describe, it, expect } from "bun:test";
import { parseId } from "../src/parse.js";
import { generateId, type EntityType } from "../src/index.js";

// Traces to: FR-ID-007 (ID parsing: extract entity type and timestamp)

// FR-007: parseId round-trip
describe("parseId", () => {
	const entities: EntityType[] = [
		"workspace",
		"lane",
		"session",
		"terminal",
		"run",
		"correlation",
	];

	for (const entity of entities) {
		it(`round-trips ${entity} ID`, () => {
			const before = Date.now();
			const id = generateId(entity);
			const after = Date.now();

			const parsed = parseId(id);
			expect(parsed).not.toBeNull();
			if (!parsed) return;

			expect(parsed.entityType).toBe(entity);
			expect(parsed.timestamp.getTime()).toBeGreaterThanOrEqual(before);
			expect(parsed.timestamp.getTime()).toBeLessThanOrEqual(after);
			expect(parsed.ulid).toHaveLength(26);
		});
	}

	it("returns null for invalid ID", () => {
		expect(parseId("")).toBeNull();
		expect(parseId("garbage")).toBeNull();
		expect(parseId("xx_01HXYZ1234567890ABCDEFGHIJ")).toBeNull();
	});

	it("extracts correct ULID body", () => {
		const id = generateId("workspace");
		const parsed = parseId(id);
		expect(parsed).not.toBeNull();
		if (!parsed) return;
		// Body should be the part after ws_
		expect(id).toBe(`ws_${parsed.ulid}`);
	});

	it("handles tampered but valid-format ULID", () => {
		// Construct a valid-looking ID with a known timestamp
		const id = "ws_00000000000000000000000000";
		const parsed = parseId(id);
		expect(parsed).not.toBeNull();
		if (!parsed) return;
		expect(parsed.timestamp.getTime()).toBe(0); // epoch
		expect(parsed.entityType).toBe("workspace");
	});
});
