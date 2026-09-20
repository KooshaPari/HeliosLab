/**
 * Cross-platform runner for the opt-in CVP scaling suite.
 *
 * The suite is opt-in because materialising hundreds of live PTYs starves
 * anything running beside it. Setting the env var here keeps `bun run
 * cvp:scaling` working on both Windows (cmd) and POSIX shells without
 * relying on shell-specific env syntax.
 *
 * Usage:
 *   bun run apps/runtime/tests/cvp/run-scaling.ts
 *   CVP_TARGET=1000 bun run apps/runtime/tests/cvp/run-scaling.ts
 *
 * @module
 */

import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(
	new URL("./cvp-scaling.test.ts", import.meta.url),
);

const proc = Bun.spawnSync(["bun", "test", testFile], {
	env: { ...process.env, CVP_SCALING: "1" },
	stdio: ["inherit", "inherit", "inherit"],
});

process.exit(proc.exitCode ?? 1);
