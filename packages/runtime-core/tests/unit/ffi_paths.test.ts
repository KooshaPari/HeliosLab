/**
 * Regression test for the native library search paths.
 *
 * The bridge previously searched "../../../packages/pty-pool/zig-out/lib",
 * which from packages/runtime-core/src/ffi resolves to
 * packages/packages/pty-pool/... and therefore matched nothing on disk. Every
 * component reported itself unbuilt, including ones that had been built.
 *
 * The reason string distinguishes the two cases, which is what makes this a
 * real test rather than a restatement of the code:
 *
 *   path wrong  -> "no build output found on disk"
 *   path right  -> a dlopen failure naming the resolved file
 *
 * So placing a placeholder where a real build would land proves the path is
 * correct, without needing the actual library or macOS.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/runtime-core/tests/unit -> repo root
const REPO = join(HERE, "..", "..", "..", "..");

// Where Zig installs its shared library for the pty-pool package.
const PLACEHOLDER_DIR = join(REPO, "packages", "pty-pool", "zig-out", "lib");
const PLACEHOLDER = join(PLACEHOLDER_DIR, "libhelios-pty.dylib");

function cleanup(): void {
	rmSync(PLACEHOLDER, { force: true });
	rmSync(PLACEHOLDER_DIR, { recursive: true, force: true });
}

describe("native library search paths", () => {
	afterAll(cleanup);

	test("the bridge resolves a build output placed at the canonical location", async () => {
		cleanup();
		mkdirSync(PLACEHOLDER_DIR, { recursive: true });
		// Deliberately not a valid library. Loading is expected to fail; what
		// matters is which failure.
		writeFileSync(PLACEHOLDER, "not a real library");

		// Imported dynamically so the path is computed in the same process, and so
		// this file does not fail to load if the bridge is later made eager.
		const { nativeStatus, resetNativeStatusCache } = await import(
			"../../src/ffi/index.ts"
		);

		// Load results are cached at module scope, so another test file in the same
		// run may already have probed and recorded "nothing found". Without this
		// reset the test passes alone and fails in the suite.
		resetNativeStatusCache();

		const status = nativeStatus();

		expect(status.pty.ok).toBe(false);
		if (status.pty.ok) return;

		const reason = status.pty.reason;

		// The real assertion: the resolver reached the file. If the search paths
		// regress to the doubled "packages/packages/..." form, the resolver finds
		// nothing and the reason becomes "no build output found on disk".
		expect(reason).not.toContain("no build output found on disk");
		expect(reason).toContain("libhelios-pty.dylib");
		// And it must be the corrected path, not some other directory that happens
		// to contain a file of that name.
		expect(reason.replace(/\\/g, "/")).toContain(
			"packages/pty-pool/zig-out/lib/libhelios-pty.dylib",
		);
	});
});
