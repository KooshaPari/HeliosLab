#!/usr/bin/env bun
/**
 * Verifies the renderer actually bundles.
 *
 * Nothing else checks this. The app build runs through Electrobun on macOS, and
 * the unit tests import modules directly, so a broken import path in the
 * renderer would surface only when someone launched the app - which no automated
 * step does.
 *
 * That is not hypothetical: the terminal store imports across package
 * boundaries with a deep relative path,
 *
 *   ../../../../packages/runtime-core/src/terminal/pty-session.ts
 *
 * which typechecks and resolves under Bun but is exactly the kind of thing a
 * bundler can refuse. This runs esbuild over the real entry point and fails if
 * any import cannot be resolved.
 *
 *   bun tools/check-renderer-bundle.ts
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ENTRY = "apps/colab-renderer/src/index.tsx";

const candidates = [
  join(ROOT, "node_modules", "@esbuild", "win32-x64", "esbuild.exe"),
  join(ROOT, "node_modules", "@esbuild", "darwin-arm64", "bin", "esbuild"),
  join(ROOT, "node_modules", "@esbuild", "darwin-x64", "bin", "esbuild"),
  join(ROOT, "node_modules", "@esbuild", "linux-x64", "bin", "esbuild"),
  join(ROOT, "node_modules", ".bin", "esbuild"),
];

const esbuild = candidates.find((p) => existsSync(p));
if (esbuild === undefined) {
  console.error("no esbuild binary found; run `bun install` first");
  process.exit(1);
}

const proc = Bun.spawnSync({
  cmd: [
    esbuild,
    ENTRY,
    "--bundle",
    // Written to a temp path; the artifact is not the point, resolution is.
    "--outfile=" + join(ROOT, "node_modules", ".cache", "renderer-bundle-check.js"),
    "--jsx=automatic",
    "--jsx-import-source=solid-js",
    "--platform=node",
    "--format=esm",
    // Real dependencies stay external: this checks first-party resolution, not
    // whether every third-party package is installed.
    "--external:solid-js",
    "--external:solid-js/*",
    "--external:@xterm/*",
    "--external:tailwindcss",
    "--external:bun:ffi",
  ],
  cwd: ROOT,
  stdout: "pipe",
  stderr: "pipe",
});

const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;

// esbuild reports resolution failures as `Could not resolve "..."`.
const unresolved = [...output.matchAll(/Could not resolve "([^"]+)"/g)].map((m) => m[1]);

if (proc.exitCode !== 0 || unresolved.length > 0) {
  console.error("renderer bundle FAILED\n");
  if (unresolved.length > 0) {
    console.error("unresolved imports:");
    for (const spec of [...new Set(unresolved)]) console.error(`  ${spec}`);
  }
  console.error(output.trim().split("\n").slice(-25).join("\n"));
  process.exit(1);
}

console.log(`renderer bundles cleanly (${ENTRY})`);
