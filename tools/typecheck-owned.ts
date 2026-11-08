#!/usr/bin/env bun
/**
 * Typecheck ratchet for the native integration surface.
 *
 * A repo-wide `tsc --noEmit` is not the gate. On 2026-10-15 that command
 * exited 0 in this tree. The gate still fails when an error lands in
 * OWNED_PREFIXES, which is how the FFI bridge shipped with errors while an
 * ad-hoc `tsc` of the same file reported it clean.
 *
 * This turns it into a ratchet. It runs the project's own typecheck, then fails
 * only if an error appears in a path this work owns. The existing baseline is
 * reported but tolerated, so the gate is usable today and prevents the native
 * packages from regressing.
 *
 *   bun tools/typecheck-owned.ts
 */

import { resolve } from "node:path";

// Prefixes tsc can actually emit. Zig/Rust/Go packages, **/*.test.ts, and
// tools/*.ts are outside tsconfig include/exclude, so listing them here made
// the gate report success for paths it never checked.
const OWNED_PREFIXES = [
	"packages/runtime-core/src/ffi/",
	"packages/runtime-core/src/terminal/",
	"apps/colab-renderer/src/stores/terminal.store.ts",
	"apps/colab-renderer/src/components/terminal/TerminalPanel.tsx",
	"apps/colab-renderer/src/components/terminal/panel-wiring.ts",
];

export function typecheckDiagnosticLines(output: string): string[] {
	return output.split(/\r?\n/).filter((line) => /error TS\d+/.test(line));
}

export function isOwned(file: string): boolean {
	const normalized = file.replace(/\\/g, "/");
	return OWNED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Returns the subset of `prefixes` that match no file in `tscFiles`.
 *
 * A dead prefix can never produce a diagnostic: if tsc does not check a file,
 * no error from that file will ever appear in the output, so the gate will
 * always claim success for that prefix regardless of how broken the code is.
 * Callers must reject dead prefixes before treating a clean run as meaningful.
 */
export function checkDeadPrefixes(
	tscFiles: readonly string[],
	prefixes: readonly string[],
): string[] {
	return prefixes.filter((prefix) => {
		const norm = prefix.replace(/\\/g, "/");
		return !tscFiles.some((f) => f.replace(/\\/g, "/").startsWith(norm));
	});
}

if (import.meta.main) {
	const repoRoot = resolve(import.meta.dir, "..");

	// ── Liveness check ──────────────────────────────────────────────────────
	// A prefix that matches no tsc-checked file is structurally dead: it can
	// never produce a diagnostic, so claiming it is "owned" gives false
	// assurance. Detect this before running the full typecheck.
	const listProc = Bun.spawnSync({
		cmd: ["bun", "x", "tsc", "--listFilesOnly"],
		stdout: "pipe",
		stderr: "pipe",
		cwd: repoRoot,
	});

	const tscFiles = listProc.stdout
		.toString()
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) =>
			line.startsWith(repoRoot + "/") ? line.slice(repoRoot.length + 1) : line,
		)
		.map((line) => line.replace(/\\/g, "/"));

	const dead = checkDeadPrefixes(tscFiles, OWNED_PREFIXES);
	if (dead.length > 0) {
		console.error(
			"FAIL: OWNED_PREFIXES contains dead entries — they cannot match any file\n" +
				"that tsc checks, so errors there would be silently ignored:\n",
		);
		for (const p of dead) console.error(`  ${p}`);
		console.error(
			"\nFix: remove the dead entries from OWNED_PREFIXES, or update the tsconfig\n" +
				"include/exclude so those paths are actually checked by tsc.",
		);
		process.exit(1);
	}

	// ── Full typecheck ───────────────────────────────────────────────────────
	const proc = Bun.spawnSync({
		cmd: ["bun", "run", "typecheck"],
		stdout: "pipe",
		stderr: "pipe",
		cwd: repoRoot,
	});

	const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;

	const errorLines = typecheckDiagnosticLines(output);

	// Turn "path(line,col): error TSxxxx: message" into structured entries.
	const errors: Array<{ file: string; detail: string }> = [];
	for (const line of errorLines) {
		const match = /^(.+?)\(\d+,\d+\): (error TS\d+: .+)$/.exec(line.trim());
		if (match) {
			errors.push({ file: match[1], detail: match[2] });
		} else {
			// Errors without a position are attributed to the file named earlier.
			const last = errors.at(-1);
			if (last) errors.push({ file: last.file, detail: line.trim() });
		}
	}

	const owned = errors.filter((e) => isOwned(e.file));
	const baseline = errors.length - owned.length;

	console.log(
		`typecheck errors: ${errors.length} total, ${baseline} pre-existing`,
	);
	console.log(`owned by this work: ${owned.length}`);

	let failed = false;
	if (owned.length === 0) {
		console.log("\nOK: no typecheck errors in the native integration surface.");
	} else {
		failed = true;
		console.error(
			`\nFAIL: ${owned.length} typecheck error(s) in paths this work owns.\n` +
				"These were added by the native integration and must be fixed, even though\n" +
				"the repo baseline is tolerated:\n",
		);
		for (const e of owned) console.error(`  ${e.file}\n    ${e.detail}`);
	}

	const testProc = Bun.spawnSync({
		cmd: [
			"bun",
			"x",
			"tsc",
			"-p",
			"tsconfig.tests.json",
			"--noEmit",
			"--pretty",
			"false",
		],
		stdout: "pipe",
		stderr: "pipe",
		cwd: repoRoot,
	});
	const testOutput = `${testProc.stdout.toString()}\n${testProc.stderr.toString()}`;
	const testErrors = typecheckDiagnosticLines(testOutput);
	console.log(`test tree typecheck errors: ${testErrors.length}`);
	if (testErrors.length > 0 || testProc.exitCode !== 0) {
		failed = true;
		console.error(
			"\nFAIL: tsconfig.tests.json typechecked the test tree and reported errors.",
		);
		for (const line of testErrors) console.error(`  ${line}`);
		if (testErrors.length === 0) console.error(testOutput);
	}

	process.exit(failed ? 1 : 0);
}
