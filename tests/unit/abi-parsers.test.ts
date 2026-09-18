/**
 * Tests for the parsers behind tools/check-abi.ts.
 *
 * These exist because the gate they feed reported "contract OK" while checking
 * nothing. The TypeScript parser matched keys by a fixed amount of indentation,
 * so under the width in the file it found zero symbols, the missing-symbol list
 * came out empty, and the gate passed. Nothing failed, because nothing was
 * compared. A parser that matches nothing and a contract that holds are
 * indistinguishable from the outside, so they are tested directly here.
 *
 * Fixtures rather than the real sources, because a fixture can pin the exact
 * shapes that broke: two levels of nesting, tabs, and lines that look like
 * declarations but are comments or string values.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	goExports,
	rustExports,
	tsSymbols,
	zigExports,
} from "../../tools/abi-parsers";

const ROOT = join(import.meta.dir, "..", "..");

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * The shape the real bridge uses: tab indentation, and a nested `args` /
 * `returns` pair inside each entry.
 */
const BRIDGE_TABS = [
	"const PTY_SYMBOLS: Symbols = {",
	"\tpty_pool_create: { args: [FFIType.u32], returns: FFIType.i32 },",
	"\tpty_pool_write: {",
	"\t\targs: [FFIType.cstring, FFIType.ptr, FFIType.u32],",
	"\t\treturns: FFIType.i32,",
	"\t},",
	"\tpty_pool_abi_version: { args: [], returns: FFIType.u32 },",
	"};",
].join("\n");

describe("tsSymbols", () => {
	test("reads the keys of the literal and not its nested fields", () => {
		expect([...tsSymbols(BRIDGE_TABS, "PTY_SYMBOLS")].sort()).toEqual([
			"pty_pool_abi_version",
			"pty_pool_create",
			"pty_pool_write",
		]);
	});

	// The regression, stated directly. Indentation-based matching returned
	// exactly these two and nothing else once the file was reformatted.
	test("does not report args or returns as symbols", () => {
		const names = tsSymbols(BRIDGE_TABS, "PTY_SYMBOLS");
		expect(names.has("args")).toBe(false);
		expect(names.has("returns")).toBe(false);
	});

	test("finds the same keys whatever the indentation width", () => {
		const fourSpaces = BRIDGE_TABS.replace(/\t/g, "    ");
		expect([...tsSymbols(fourSpaces, "PTY_SYMBOLS")].sort()).toEqual([
			"pty_pool_abi_version",
			"pty_pool_create",
			"pty_pool_write",
		]);
	});

	test("ignores colons inside comments and string values", () => {
		const noisy = [
			"const PERSISTENCE_SYMBOLS: Symbols = {",
			"\t// format: helios_db_open takes a path",
			'\thelios_db_open_label: "not_a_key: just text",',
			"\thelios_db_open: { args: [FFIType.cstring], returns: FFIType.ptr },",
			"};",
		].join("\n");
		expect([...tsSymbols(noisy, "PERSISTENCE_SYMBOLS")].sort()).toEqual([
			"helios_db_open",
			"helios_db_open_label",
		]);
	});

	test("throws when the named table is absent rather than returning empty", () => {
		expect(() => tsSymbols(BRIDGE_TABS, "MISSING_SYMBOLS")).toThrow(
			"const MISSING_SYMBOLS not found",
		);
	});
});

describe("zigExports", () => {
	// The second regression: every export in the repo is `pub export fn`, and
	// the parser only accepted a line starting with `export fn`, so it reported
	// all fifteen as missing.
	test("finds pub export fn, which is how the repo writes them", () => {
		const source = [
			"pub export fn pty_pool_create(max_pty: u32) i32 {",
			"    return 0;",
			"}",
			"pub export fn pty_pool_spawn(",
			"    handle: i32,",
			") i32 {",
			"    return 0;",
			"}",
		].join("\n");
		expect([...zigExports(source)].sort()).toEqual([
			"pty_pool_create",
			"pty_pool_spawn",
		]);
	});

	test("still finds a bare export fn", () => {
		expect([...zigExports("export fn plain() void {}")]).toEqual(["plain"]);
	});
});

describe("goExports", () => {
	test("finds //export directives", () => {
		const source = [
			"//export HeliosOrchestratorNew",
			"func HeliosOrchestratorNew() C.int { return 0 }",
			"",
			"//export HeliosOrchestratorClose",
			"func HeliosOrchestratorClose(h C.int) {}",
		].join("\n");
		expect([...goExports(source)].sort()).toEqual([
			"HeliosOrchestratorClose",
			"HeliosOrchestratorNew",
		]);
	});
});

describe("rustExports", () => {
	test("finds no_mangle extern C functions", () => {
		const source = [
			"#[no_mangle]",
			'pub extern "C" fn helios_db_open(path: *const c_char) -> *mut Db {',
			"    todo!()",
			"}",
		].join("\n");
		expect([...rustExports(source)]).toEqual(["helios_db_open"]);
	});
});

/**
 * The check is only as good as these parsers against the real files, so the
 * counts are asserted here too. Every assertion below fails if a parser goes
 * blind, which is the failure the unit fixtures above describe in the abstract.
 */
describe("against the real sources", () => {
	const bridge = read("packages/runtime-core/src/ffi/index.ts");

	test("every symbol table in the bridge is found and non-empty", () => {
		for (const table of [
			"PTY_SYMBOLS",
			"PERSISTENCE_SYMBOLS",
			"ORCHESTRATOR_SYMBOLS",
			"DEVICE_SYMBOLS",
		]) {
			expect(tsSymbols(bridge, table).size).toBeGreaterThan(0);
		}
	});

	test("every native declaration block is found and non-empty", () => {
		expect(
			zigExports(read("packages/pty-pool/src/main.zig")).size,
		).toBeGreaterThan(0);
		expect(
			rustExports(read("packages/persistence/src/lib.rs")).size,
		).toBeGreaterThan(0);
		expect(
			goExports(read("packages/orchestrator/cshared/main.go")).size,
		).toBeGreaterThan(0);
		expect(
			goExports(read("packages/device-manager/cshared/main.go")).size,
		).toBeGreaterThan(0);
	});

	test("the Zig bridge symbols and exports agree", () => {
		const declared = tsSymbols(bridge, "PTY_SYMBOLS");
		const exported = zigExports(read("packages/pty-pool/src/main.zig"));
		expect(declared.size).toBe(exported.size);
		for (const name of declared) expect(exported.has(name)).toBe(true);
	});
});
