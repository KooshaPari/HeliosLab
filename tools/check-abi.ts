#!/usr/bin/env bun
/**
 * Cross-language ABI contract check.
 *
 * The FFI bridge calls native symbols by name. If a name in the TypeScript
 * symbol table does not exist in the compiled library, the failure surfaces at
 * runtime as a missing-symbol throw, typically on a user path. This checks the
 * contract statically, from source, so it needs no toolchain and no build.
 *
 * CI additionally checks the compiled artifacts with `nm`, which catches names
 * that exist in source but are not exported. This script catches the other
 * direction, and catches it before anything is compiled at all.
 *
 *   bun tools/check-abi.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

let failures = 0;

function fail(message: string): void {
	failures++;
	console.error(`  MISMATCH: ${message}`);
}

/** Extract the keys of a named object literal from the TS bridge. */
function tsSymbols(source: string, constName: string): Set<string> {
	const start = source.indexOf(`const ${constName}`);
	if (start === -1) throw new Error(`TS: const ${constName} not found`);

	// Walk braces from the opening brace to its match.
	const open = source.indexOf("{", start);
	let depth = 0;
	let end = open;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}

	const body = source.slice(open, end);
	const names = new Set<string>();

	// The symbol names are the keys at the literal's own depth. Slicing from
	// the opening brace leaves that brace in the body, so the keys sit at
	// depth 1 and everything nested is deeper. Keying off a fixed amount of
	// indentation instead binds this to a whitespace style: it matched
	// nothing under four spaces, and once the repo was reformatted to tabs it
	// matched `args` and `returns` two levels down and reported them as
	// missing symbols.
	const key = /([A-Za-z_$][A-Za-z0-9_$]*)\s*:/y;
	let depthInBody = 0;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];

		if (ch === "{") {
			depthInBody++;
			continue;
		}
		if (ch === "}") {
			depthInBody--;
			continue;
		}
		// Skip comments and strings so a colon inside either is never read as
		// the end of a key.
		if (ch === "/" && body[i + 1] === "/") {
			while (i < body.length && body[i] !== "\n") i++;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			for (i++; i < body.length && body[i] !== ch; i++) {
				if (body[i] === "\\") i++;
			}
			continue;
		}
		if (depthInBody !== 1) continue;

		key.lastIndex = i;
		const m = key.exec(body);
		if (m) {
			names.add(m[1]);
			i = key.lastIndex - 1;
		}
	}
	return names;
}

/** `//export Name` directives in a Go cgo shim. */
function goExports(source: string): Set<string> {
	const names = new Set<string>();
	for (const m of source.matchAll(/^\/\/export\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
		names.add(m[1]);
	}
	return names;
}

/** `#[no_mangle] pub extern "C" fn name` in Rust. */
function rustExports(source: string): Set<string> {
	const names = new Set<string>();
	const re =
		/#\[no_mangle\]\s*pub\s+extern\s+"C"\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/g;
	for (const m of source.matchAll(re)) names.add(m[1]);
	return names;
}

/** `export fn name` in Zig, with or without `pub`. */
function zigExports(source: string): Set<string> {
	const names = new Set<string>();
	for (const m of source.matchAll(
		/^(?:pub\s+)?export\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
	)) {
		names.add(m[1]);
	}
	return names;
}

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

interface Contract {
	label: string;
	bridge: Set<string>;
	native: Set<string>;
	nativeFile: string;
}

function check({ label, bridge, native, nativeFile }: Contract): void {
	console.log(`\n${label}`);
	console.log(
		`  bridge declares ${bridge.size}, ${nativeFile} exports ${native.size}`,
	);

	const missing = [...bridge].filter((n) => !native.has(n)).sort();
	if (missing.length > 0) {
		fail(
			`${label}: the bridge calls these but they are not exported:\n` +
				missing.map((n) => `      ${n}`).join("\n"),
		);
	}

	const unused = [...native].filter((n) => !bridge.has(n)).sort();
	if (unused.length > 0) {
		// Informational: an export nobody calls is dead weight, not a break.
		console.log(
			`  note: exported but not called by the bridge: ${unused.join(", ")}`,
		);
	}

	if (missing.length === 0) console.log("  contract OK");
}

const bridge = read("packages/runtime-core/src/ffi/index.ts");

check({
	label: "PTY pool (Zig)",
	bridge: tsSymbols(bridge, "PTY_SYMBOLS"),
	native: zigExports(read("packages/pty-pool/src/main.zig")),
	nativeFile: "pty-pool/src/main.zig",
});

check({
	label: "Persistence (Rust)",
	bridge: tsSymbols(bridge, "PERSISTENCE_SYMBOLS"),
	native: rustExports(read("packages/persistence/src/lib.rs")),
	nativeFile: "persistence/src/lib.rs",
});

check({
	label: "Orchestrator (Go)",
	bridge: tsSymbols(bridge, "ORCHESTRATOR_SYMBOLS"),
	native: goExports(read("packages/orchestrator/cshared/main.go")),
	nativeFile: "orchestrator/cshared/main.go",
});

check({
	label: "Device manager (Go)",
	bridge: tsSymbols(bridge, "DEVICE_SYMBOLS"),
	native: goExports(read("packages/device-manager/cshared/main.go")),
	nativeFile: "device-manager/cshared/main.go",
});

console.log(
	failures === 0
		? "\nAll FFI symbol contracts match."
		: `\n${failures} contract mismatch(es).`,
);
process.exit(failures === 0 ? 0 : 1);
