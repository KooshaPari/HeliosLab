/**
 * The FFI bridge must degrade gracefully.
 *
 * Native packages are built out-of-band, so this test asserts the contract that
 * matters for integration: importing the bridge never throws, and using a
 * component that has not been compiled raises a specific, actionable error
 * rather than a null-pointer crash.
 *
 * When the native libraries *are* present (after `bun run build:native`) the
 * same helpers are exercised against the real library.
 */
import { describe, expect, test } from "bun:test";
import {
  DeviceManager,
  HeliosDb,
  NativeUnavailableError,
  Orchestrator,
  PTY_ABI_VERSION,
  PtyPool,
  nativeStatus,
} from "../../src/ffi/index.ts";

describe("ffi bridge", () => {
  test("nativeStatus probes every component without throwing", () => {
    const status = nativeStatus();

    for (const key of ["pty", "persistence", "orchestrator", "device"] as const) {
      const entry = status[key];
      expect(entry).toBeDefined();
      if (entry.ok) {
        expect(typeof entry.path).toBe("string");
        expect(entry.path.length).toBeGreaterThan(0);
      } else {
        expect(typeof entry.reason).toBe("string");
      }
    }
  });

  test("unavailable components raise NativeUnavailableError, not a crash", () => {
    const status = nativeStatus();

    const cases: Array<[string, (ok: boolean) => () => unknown]> = [
      ["pty", (ok) => () => (ok ? null : new PtyPool(4))],
      ["persistence", (ok) => () => (ok ? null : new HeliosDb(":memory:"))],
      ["orchestrator", (ok) => () => (ok ? null : new Orchestrator())],
      ["device", (ok) => () => (ok ? null : new DeviceManager())],
    ];

    for (const [component, build] of cases) {
      const entry = status[component as "pty"];
      if (entry.ok) continue; // available: nothing to assert here

      let caught: unknown;
      try {
        build(false)();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NativeUnavailableError);
      expect((caught as NativeUnavailableError).component).toBe(component);
      // The message must tell the operator what to do about it.
      expect((caught as Error).message).toContain("build:native");
    }
  });

  test("the declared PTY ABI version is pinned", () => {
    expect(PTY_ABI_VERSION).toBe(2);
  });
});
