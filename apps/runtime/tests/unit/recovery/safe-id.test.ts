/**
 * Tests for the filesystem-safe identifier helpers used by the
 * durable stores. These helpers gate every `path.join(baseDir, ...)`
 * call so a regression here is a path-traversal vulnerability.
 */
import { describe, expect, test } from "bun:test";
import {
	assertSafeId,
	MAX_SAFE_ID_LENGTH,
	sanitizeSafeId,
} from "../../../src/recovery/safe-id.js";

describe("assertSafeId", () => {
	test("accepts ASCII alphanumerics and underscores", () => {
		expect(() => assertSafeId("abc_123", "label")).not.toThrow();
	});

	test("accepts hyphens and dots", () => {
		expect(() => assertSafeId("abc-123.def", "label")).not.toThrow();
	});

	test("rejects non-string input", () => {
		expect(() => assertSafeId(123, "label")).toThrow(/must be a string/);
		expect(() => assertSafeId(null, "label")).toThrow(/must be a string/);
		expect(() => assertSafeId(undefined, "label")).toThrow(/must be a string/);
		expect(() => assertSafeId({}, "label")).toThrow(/must be a string/);
	});

	test("rejects empty string", () => {
		expect(() => assertSafeId("", "label")).toThrow(/unsafe/);
	});

	test("rejects path traversal sequences", () => {
		expect(() => assertSafeId("../etc/passwd", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("a/../b", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("..", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("foo/..", "label")).toThrow(/unsafe/);
	});

	test("rejects identifiers exceeding MAX_SAFE_ID_LENGTH", () => {
		const tooLong = "a".repeat(MAX_SAFE_ID_LENGTH + 1);
		expect(() => assertSafeId(tooLong, "label")).toThrow(/unsafe/);
	});

	test("rejects leading or trailing dots", () => {
		expect(() => assertSafeId(".hidden", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("trailing.", "label")).toThrow(/unsafe/);
	});

	test("rejects leading or trailing whitespace", () => {
		expect(() => assertSafeId(" leading", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("trailing ", "label")).toThrow(/unsafe/);
	});

	test("rejects characters outside [A-Za-z0-9_.-]", () => {
		expect(() => assertSafeId("a/b", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("a\\b", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("a:b", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("a b", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("a*b", "label")).toThrow(/unsafe/);
		expect(() => assertSafeId("héllo", "label")).toThrow(/unsafe/);
	});

	test("includes the label in the error message", () => {
		expect(() => assertSafeId("a/b", "SessionCheckpoint.session_id")).toThrow(
			/SessionCheckpoint\.session_id/,
		);
	});
});

describe("sanitizeSafeId", () => {
	test("returns safe input verbatim", () => {
		expect(sanitizeSafeId("abc-123")).toBe("abc-123");
		expect(sanitizeSafeId("abc_123")).toBe("abc_123");
		expect(sanitizeSafeId("abc.123")).toBe("abc.123");
	});

	test("prefixes a hash when sanitisation changes the input", () => {
		const result = sanitizeSafeId("a/b");
		// Should not equal the trivial sanitisation (which would be "a_b").
		expect(result).not.toBe("a_b");
		expect(result).toContain("a_b");
		expect(result.length).toBeGreaterThan(3);
	});

	test("distinct unsafe inputs do not collide", () => {
		// Both naive-sanitise to "a_b" but the hash prefix disambiguates them.
		const id1 = sanitizeSafeId("a/b");
		const id2 = sanitizeSafeId("a\\b");
		expect(id1).not.toBe(id2);
	});

	test("throws on empty input", () => {
		expect(() => sanitizeSafeId("")).toThrow(/non-empty/);
	});

	test("throws on path-traversal input", () => {
		expect(() => sanitizeSafeId("../etc/passwd")).toThrow(/path-traversal/);
		expect(() => sanitizeSafeId("a/../b")).toThrow(/path-traversal/);
	});

	test("throws on input with leading/trailing whitespace", () => {
		expect(() => sanitizeSafeId(" leading")).toThrow(/path-traversal/);
		expect(() => sanitizeSafeId("trailing ")).toThrow(/path-traversal/);
	});

	test("truncates combined output to MAX_SAFE_ID_LENGTH", () => {
		const longUnsafe = `${"x".repeat(250)}/more-stuff`;
		const result = sanitizeSafeId(longUnsafe);
		expect(result.length).toBeLessThanOrEqual(MAX_SAFE_ID_LENGTH);
	});

	test("sanitises unicode characters", () => {
		const result = sanitizeSafeId("héllo");
		// `é` is not in the safe set, so this gets sanitised + hash-prefixed.
		expect(result).toContain("h_llo");
		expect(result).not.toBe("héllo");
	});
});
