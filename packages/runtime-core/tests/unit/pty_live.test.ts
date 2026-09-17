/**
 * Exercises the real FFI bridge against the real library.
 *
 * Unlike the contract test next door, which asserts graceful degradation when
 * nothing is built, this one requires libhelios-pty.dylib to exist and drives a
 * live PTY through it. It is the only test that covers the whole path:
 * TypeScript -> Bun dlopen -> C ABI symbol lookup -> Zig -> the kernel.
 *
 * Run on macOS after `bun run build:native`, or from CI's native-link job.
 */
import { describe, expect, test } from "bun:test";
import { PtyPool, nativeStatus } from "../../src/ffi/index.ts";

const status = nativeStatus();

describe("pty pool over the live FFI bridge", () => {
  test("the bridge locates and loads the built library", () => {
    // Fails loudly rather than skipping: if the library is expected to be built
    // but the bridge cannot find it, the search paths are wrong, which is a bug
    // worth surfacing instead of silently passing.
    if (!status.pty.ok) {
      throw new Error(
        `bridge could not load the PTY library: ${status.pty.reason}`,
      );
    }
    expect(status.pty.path).toContain("helios-pty");
  });

  test("spawns a shell and reads its output through the ABI", () => {
    const pool = new PtyPool(8);
    // The ABI version is asserted inside the constructor, so reaching here
    // already proves the loaded library matches this bridge.
    expect(pool.liveCount).toBe(0);

    const handle = pool.spawn({ shell: "/bin/sh", cols: 100, rows: 30 });
    expect(handle).toBeGreaterThanOrEqual(0);
    expect(pool.liveCount).toBe(1);

    pool.write(handle, "echo BRIDGE_OK\n");
    expect(pool.resize(handle, 120, 40)).toBeUndefined(); // throws on failure

    let seen = "";
    for (let i = 0; i < 400 && !seen.includes("BRIDGE_OK"); i++) {
      pool.pump(handle);
      const chunk = pool.read(handle);
      if (chunk.length > 0) seen += new TextDecoder().decode(chunk);
    }

    expect(seen).toContain("BRIDGE_OK");

    pool.destroy(handle);
    expect(pool.liveCount).toBe(0);
  });

  test("reports a child's exit status through the bridge", () => {
    const pool = new PtyPool(8);
    const handle = pool.spawn({ shell: "/bin/sh" });
    pool.write(handle, "exit 9\n");

    for (let i = 0; i < 400 && pool.exitCode(handle) === -2; i++) {
      pool.pump(handle);
      pool.reap(handle);
    }

    expect(pool.exitCode(handle)).toBe(9);
    pool.destroy(handle);
  });
});
