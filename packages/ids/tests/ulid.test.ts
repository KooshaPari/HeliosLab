import { describe, it, expect } from "bun:test";
import {
	generateUlid,
	encodeTime,
	decodeTime,
	CROCKFORD_BASE32,
} from "../src/ulid.js";

// FR-001: ULID generation
describe("ULID generation", () => {
	it("produces 26-character string", () => {
		const id = generateUlid();
		expect(id).toHaveLength(26);
	});

	it("contains only valid Crockford base32 characters", () => {
		// FR-002: Crockford base32 encoding
		const id = generateUlid();
		const validChars = new Set(CROCKFORD_BASE32);
		for (const ch of id) {
			expect(validChars.has(ch)).toBe(true);
		}
	});

	it("does not contain I, L, O, U characters", () => {
		const ids = Array.from({ length: 100 }, () => generateUlid());
		for (const id of ids) {
			expect(id).not.toMatch(/[ILOU]/);
		}
	});

	// FR-003: Monotonic ordering within same millisecond
	it("produces monotonically ordered IDs in tight loop", () => {
		const ids = Array.from({ length: 1000 }, () => generateUlid());
		for (let i = 1; i < ids.length; i++) {
			expect(ids[i] > ids[i - 1]).toBe(true);
		}
	});

	it("produces lexicographically ordered IDs across different milliseconds", async () => {
		const id1 = generateUlid();
		await new Promise((r) => setTimeout(r, 2));
		const id2 = generateUlid();
		expect(id2 > id1).toBe(true);
	});
});

// FR-001: Time encoding/decoding
describe("encodeTime / decodeTime", () => {
	it("round-trips current timestamp", () => {
		const now = Date.now();
		const encoded = encodeTime(now);
		expect(encoded).toHaveLength(10);
		const decoded = decodeTime(encoded);
		expect(decoded).toBe(now);
	});

	it("handles epoch (0)", () => {
		const encoded = encodeTime(0);
		expect(decodeTime(encoded)).toBe(0);
	});

	it("handles max timestamp", () => {
		const max = 281474976710655; // 2^48 - 1
		const encoded = encodeTime(max);
		expect(decodeTime(encoded)).toBe(max);
	});

	it("throws on negative timestamp", () => {
		expect(() => encodeTime(-1)).toThrow();
	});

	it("throws on overflow timestamp", () => {
		expect(() => encodeTime(281474976710656)).toThrow();
	});
});
