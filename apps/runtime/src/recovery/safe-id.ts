/**
 * Filesystem-safe identifier helpers used by the durable stores.
 *
 * The runtime accepts user-controllable identifiers (session IDs from
 * `session.attach`, checkpoint IDs supplied by the caller, audit record
 * IDs) and uses them as path components under `<dataDir>/recovery/...`.
 * Without normalisation, an attacker who controls these values could
 * inject `../` sequences to escape the store directory and read or
 * overwrite arbitrary files. These helpers enforce a strict safe
 * character set and a stable collision-resistant fallback for any
 * identifier that arrives with characters outside it.
 *
 * Public API:
 * - {@link assertSafeId} — throws on unsafe input (used by stores
 *   that should refuse to operate on attacker-controlled paths).
 * - {@link sanitizeSafeId} — never throws; replaces unsafe characters
 *   with `_` and prefixes a SHA-256 hash when sanitisation changes
 *   the input so distinct IDs do not collide.
 */

import { createHash } from "node:crypto";

/**
 * Characters allowed in a safe identifier: ASCII letters, digits,
 * `-`, `_`, and `.`. The dot is permitted so existing checkpoints
 * that use UUIDs with hyphens keep working; the validator rejects
 * `..` and leading dots separately.
 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Maximum length for a safe identifier. Anything longer is rejected
 * so that adversarial inputs cannot push the path beyond platform
 * limits (`PATH_MAX` is 4096 on Linux but the typical ext4 limit is
 * 255 bytes per component).
 */
export const MAX_SAFE_ID_LENGTH = 200;

function isUnsafe(input: string): boolean {
	if (input.length === 0 || input.length > MAX_SAFE_ID_LENGTH) return true;
	if (input.includes("..")) return true;
	if (input !== input.trim()) return true;
	if (input.startsWith(".") || input.endsWith(".")) return true;
	return !SAFE_ID_PATTERN.test(input);
}

/**
 * Reject any identifier that could escape `<dataDir>/recovery/...` when
 * used as a path component. Used by stores that need to refuse unsafe
 * input rather than silently rewrite it.
 */
export function assertSafeId(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string`);
	}
	if (isUnsafe(value)) {
		throw new Error(
			`${label} contains unsafe characters or path segments: ${JSON.stringify(value)}`,
		);
	}
}

/**
 * Produce a safe filesystem identifier from an arbitrary input. The
 * transformation is lossless for already-safe inputs (the input is
 * returned verbatim). For unsafe inputs the unsafe characters are
 * replaced with `_` and, if the replacement actually changes the
 * value, a SHA-256-derived hash is prefixed so two distinct unsafe
 * inputs cannot collide on the same sanitised filename.
 *
 * - `"abc-123"` → `"abc-123"` (unchanged)
 * - `"a/b"` → `"hash(a/b)_a_b"` (collision-resistant)
 * - `"../../etc/passwd"` → throws (refuses path-traversal entirely)
 */
export function sanitizeSafeId(value: string): string {
	if (value.length === 0) {
		throw new Error("safeId: input must be non-empty");
	}
	if (value.includes("..") || value !== value.trim()) {
		throw new Error(
			`safeId: input contains path-traversal segments: ${JSON.stringify(value)}`,
		);
	}
	if (!isUnsafe(value)) return value;

	// Path-traversal was already rejected above; this branch handles
	// inputs that are merely character-unsafe (e.g. spaces, slashes
	// that are not `..`, unicode). Use a hash prefix to guarantee no
	// two distinct unsafe inputs collide.
	const sanitised = value.replace(/[^A-Za-z0-9_.-]/g, "_");
	const hash = createHash("sha256").update(value).digest("hex").slice(0, 16);
	const prefix = `${hash.slice(0, 8)}_${hash.slice(8, 16)}`;
	const combined = `${prefix}_${sanitised}`;
	return combined.length > MAX_SAFE_ID_LENGTH
		? combined.slice(0, MAX_SAFE_ID_LENGTH)
		: combined;
}
