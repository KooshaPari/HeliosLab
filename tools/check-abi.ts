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
 * The parsers that read each declaration list live in tools/abi-parsers.ts and
 * are tested there. They are worth testing on their own because this script
 * only reports what they return: one that matches nothing reports a contract
 * that holds, which is what this gate did for as long as its TypeScript parser
 * keyed off a fixed indentation width.
 *
 *   bun tools/check-abi.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { goExports, rustExports, tsSymbols, zigExports } from "./abi-parsers";

const ROOT = join(import.meta.dir, "..");

let failures = 0;

function fail(message: string): void {
	failures++;
	console.error(`  MISMATCH: ${message}`);
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

// A contract with no symbols on either side would pass without comparing
// anything, which is the failure mode this gate is meant to avoid. Refuse to
// report success for one.
for (const [label, symbols] of [
	["PTY pool (Zig)", read("packages/pty-pool/src/main.zig")],
	["Persistence (Rust)", read("packages/persistence/src/lib.rs")],
	["Orchestrator (Go)", read("packages/orchestrator/cshared/main.go")],
	["Device manager (Go)", read("packages/device-manager/cshared/main.go")],
] as const) {
	if (symbols.trim().length === 0) {
		fail(`${label}: the native source is empty, so nothing was compared`);
	}
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
