/**
 * Unit tests for tools/typecheck-owned.ts
 *
 * These tests exercise the pure logic that decides which prefixes are "owned"
 * and which are "dead" (cannot match any file tsc actually checks).  No real
 * tsc invocation is needed; fixture data stands in for the --listFilesOnly
 * output.
 *
 *   bun test tools/typecheck-owned.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
	checkDeadPrefixes,
	isOwned,
	typecheckDiagnosticLines,
} from "./typecheck-owned";

// Simulates a subset of `tsc --listFilesOnly` output normalised to repo-relative
// paths.  Only src/ files appear because tsconfig.json's include pattern is
// `apps/*/src/**` and `packages/*/src/**`, and its exclude pattern removes
// `**/*.test.ts`.
const FIXTURE_TSC_FILES = [
	"packages/runtime-core/src/ffi/bridge.ts",
	"packages/runtime-core/src/ffi/codec.ts",
	"packages/runtime-core/src/terminal/session.ts",
	"apps/colab-renderer/src/stores/terminal.store.ts",
	"apps/colab-renderer/src/components/terminal/TerminalPanel.tsx",
	"apps/colab-renderer/src/components/terminal/panel-wiring.ts",
];

// ---------------------------------------------------------------------------
// isOwned
// ---------------------------------------------------------------------------

describe("isOwned", () => {
	test("returns true for a file under an owned src prefix", () => {
		expect(isOwned("packages/runtime-core/src/ffi/bridge.ts")).toBe(true);
	});

	test("returns true for a directly named owned source file", () => {
		expect(
			isOwned("apps/colab-renderer/src/components/terminal/TerminalPanel.tsx"),
		).toBe(true);
	});

	test("does not treat an excluded test file as tsc-owned", () => {
		expect(
			isOwned("packages/runtime-core/tests/unit/ffi_bridge.test.ts"),
		).toBe(false);
	});

	test("returns false for a file not in any owned prefix", () => {
		expect(isOwned("packages/errors/src/index.ts")).toBe(false);
	});

	test("normalises backslashes so Windows paths match on any platform", () => {
		expect(isOwned("packages\\runtime-core\\src\\ffi\\bridge.ts")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// checkDeadPrefixes
// ---------------------------------------------------------------------------

describe("checkDeadPrefixes", () => {
	test("a prefix with at least one matching file in the tsc list is live", () => {
		const dead = checkDeadPrefixes(FIXTURE_TSC_FILES, [
			"packages/runtime-core/src/ffi/",
		]);
		expect(dead).toEqual([]);
	});

	test("a package with no TypeScript src (e.g. Zig/Rust/Go) is dead", () => {
		// packages/pty-pool/ is a Zig package; tsc never lists any file under it.
		const dead = checkDeadPrefixes(FIXTURE_TSC_FILES, ["packages/pty-pool/"]);
		expect(dead).toEqual(["packages/pty-pool/"]);
	});

	test("a *.test.ts file excluded from tsconfig is dead", () => {
		// tsconfig.json excludes **/*.test.ts, so ffi_bridge.test.ts never appears
		// in tsc output even though it exists on disk.
		const dead = checkDeadPrefixes(FIXTURE_TSC_FILES, [
			"packages/runtime-core/tests/unit/ffi_bridge.test.ts",
		]);
		expect(dead).toEqual([
			"packages/runtime-core/tests/unit/ffi_bridge.test.ts",
		]);
	});

	test("tools/ entries not in tsconfig include are dead", () => {
		// tsconfig.json includes only apps/*/src and packages/*/src — tools/ is out.
		const dead = checkDeadPrefixes(FIXTURE_TSC_FILES, ["tools/check-abi.ts"]);
		expect(dead).toEqual(["tools/check-abi.ts"]);
	});

	test("mixed: returns only the dead prefixes, not the live ones", () => {
		const dead = checkDeadPrefixes(FIXTURE_TSC_FILES, [
			"packages/runtime-core/src/ffi/", // live — has matching files
			"packages/pty-pool/", // dead — Zig package, no TS source
			"packages/runtime-core/tests/unit/ffi_bridge.test.ts", // dead — excluded by tsconfig
		]);
		expect(dead).toEqual([
			"packages/pty-pool/",
			"packages/runtime-core/tests/unit/ffi_bridge.test.ts",
		]);
	});

	test("empty tscFiles makes every prefix dead", () => {
		const dead = checkDeadPrefixes([], [
			"packages/runtime-core/src/ffi/",
			"packages/pty-pool/",
		]);
		expect(dead).toEqual([
			"packages/runtime-core/src/ffi/",
			"packages/pty-pool/",
		]);
	});

	test("empty prefixes list returns empty array regardless of tscFiles", () => {
		const dead = checkDeadPrefixes(FIXTURE_TSC_FILES, []);
		expect(dead).toEqual([]);
	});
});

describe("typecheckDiagnosticLines", () => {
	test("counts a diagnostic in a test file", () => {
		const lines = typecheckDiagnosticLines(
			"apps/runtime/tests/unit/diagnostics/metrics.test.ts(4,10): error TS2304: Cannot find name 'expect'.\n",
		);
		expect(lines).toHaveLength(1);
	});

	test("ignores lines that are not compiler diagnostics", () => {
		expect(typecheckDiagnosticLines("$ tsc --noEmit\nOK\n")).toEqual([]);
	});
});
