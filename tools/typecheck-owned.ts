#!/usr/bin/env bun
/**
 * Typecheck ratchet for the native integration surface.
 *
 * `bun run typecheck` currently reports ~1041 pre-existing errors across the
 * repo, so it cannot be used as a pass/fail gate. That is exactly how the FFI
 * bridge shipped with 40 errors while an ad-hoc `tsc` invocation of the same
 * file reported it clean: with no gate, nothing disagreed with me.
 *
 * This turns it into a ratchet. It runs the project's own typecheck, then fails
 * only if an error appears in a path this work owns. The existing baseline is
 * reported but tolerated, so the gate is usable today and prevents the native
 * packages from regressing.
 *
 *   bun tools/typecheck-owned.ts
 */

const OWNED_PREFIXES = [
  "packages/pty-pool/",
  "packages/persistence/",
  "packages/orchestrator/",
  "packages/device-manager/",
  "packages/runtime-core/src/ffi/",
  "packages/runtime-core/src/terminal/",
  // Listed individually rather than as all of tests/unit, because that
  // directory predates this work and contains files with pre-existing errors.
  // Widening to the whole directory would make the gate fail on somebody
  // else's backlog, which is how a ratchet gets deleted instead of used.
  "packages/runtime-core/tests/unit/ffi_bridge.test.ts",
  "packages/runtime-core/tests/unit/ffi_paths.test.ts",
  "packages/runtime-core/tests/unit/pty_live.test.ts",
  "packages/runtime-core/tests/unit/pty_session.test.ts",
  "apps/colab-renderer/src/stores/terminal.store.ts",
  "apps/colab-renderer/tests/unit/stores/terminal.store.test.ts",
  "tools/check-abi.ts",
  "tools/typecheck-owned.ts",
];

function isOwned(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  return OWNED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

const proc = Bun.spawnSync({
  cmd: ["bun", "run", "typecheck"],
  stdout: "pipe",
  stderr: "pipe",
  cwd: `${import.meta.dir}/..`,
});

const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;

const errorLines = output
  .split(/\r?\n/)
  .filter((line) => /error TS\d+/.test(line));

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

console.log(`typecheck errors: ${errors.length} total, ${baseline} pre-existing`);
console.log(`owned by this work: ${owned.length}`);

if (owned.length === 0) {
  console.log("\nOK: no typecheck errors in the native integration surface.");
  process.exit(0);
}

console.error(
  `\nFAIL: ${owned.length} typecheck error(s) in paths this work owns.\n` +
    "These were added by the native integration and must be fixed, even though\n" +
    "the repo baseline is tolerated:\n",
);
for (const e of owned) console.error(`  ${e.file}\n    ${e.detail}`);
process.exit(1);
