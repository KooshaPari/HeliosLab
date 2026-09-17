/**
 * Drives terminal sessions against a real PTY.
 *
 * Requires a built native library and a POSIX host, so it skips on Windows for
 * the same reason pty_live.test.ts does: a Mach-O or ELF library cannot load
 * there, and a failure would say nothing about the code.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { PtySessionManager } from "../../src/terminal/pty-session.ts";

const onWindows = process.platform === "win32";

/** Poll until `predicate` holds, or give up. */
async function until(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(5);
  }
  return predicate();
}

function decoderCollector() {
  const decoder = new TextDecoder();
  let text = "";
  return {
    append: (chunk: Uint8Array) => {
      text += decoder.decode(chunk, { stream: true });
    },
    get: () => text,
  };
}

describe.skipIf(onWindows)("pty session manager", () => {
  const manager = new PtySessionManager({ pollMs: 5, maxPty: 8 });

  // Sessions are closed after every test, not only at the end of the file. Each
  // one owns a setInterval that calls into native code, and leaving those
  // timers live across test boundaries was aborting the Bun process when the
  // file ran as a whole. Every test passed when run on its own, which is what
  // pointed at interaction rather than at any single behaviour.
  afterEach(() => {
    manager.closeAll();
  });

  afterAll(() => {
    manager.closeAll();
  });

  test("runs a shell and surfaces its output", async () => {
    const out = decoderCollector();
    manager.open("one", { shell: "/bin/sh", cols: 90, rows: 25 }, {
      onData: out.append,
    });

    expect(manager.sessionCount).toBe(1);
    expect(manager.has("one")).toBe(true);

    manager.write("one", "echo SESSION_MARKER\n");
    const seen = await until(() => out.get().includes("SESSION_MARKER"));
    expect(seen).toBe(true);
    expect(out.get()).toContain("SESSION_MARKER");

    manager.close("one");
    expect(manager.has("one")).toBe(false);
    expect(manager.sessionCount).toBe(0);
  });

  test("resizing does not disturb the session", async () => {
    const out = decoderCollector();
    manager.open("resize", { shell: "/bin/sh" }, { onData: out.append });

    await until(() => manager.has("resize"));
    manager.resize("resize", 133, 47);

    // The shell reports what the kernel believes, which came from the resize.
    manager.write("resize", "stty size\n");
    const seen = await until(() => out.get().includes("47 133"));
    expect(seen).toBe(true);

    manager.close("resize");
  });

  test("reports the child's exit code and stops the session", async () => {
    const out = decoderCollector();
    let exitCode: number | null = null;

    manager.open("exiting", { shell: "/bin/sh" }, {
      onData: out.append,
      onExit: (code) => {
        exitCode = code;
      },
    });

    manager.write("exiting", "exit 5\n");

    const reported = await until(() => exitCode !== null || !manager.has("exiting"));
    expect(reported).toBe(true);
    // Number(...) rather than a direct toBe(5): TypeScript narrows `exitCode`
    // to `null` because the only assignment is inside the callback above, so a
    // direct comparison has no matching overload. If it were still null this
    // would compare 0, not 5, and fail as intended.
    expect(Number(exitCode)).toBe(5);
    expect(manager.has("exiting")).toBe(false);
  });

  test("refuses a duplicate id rather than leaking a handle", () => {
    manager.open("dupe", { shell: "/bin/sh" });
    expect(() => manager.open("dupe", { shell: "/bin/sh" })).toThrow(/already open/);
    manager.close("dupe");
  });

  test("writing to an unknown session is a no-op, not a throw", () => {
    // The renderer can plausibly write after a session ended, and a throw there
    // would surface as a crash in a UI event handler.
    expect(manager.write("nobody", "x")).toBe(0);
    expect(() => manager.resize("nobody", 80, 24)).not.toThrow();
    expect(() => manager.close("nobody")).not.toThrow();
  });
});
