import { ZellijCli } from "../cli.js";

/**
 * Unit tests for ZellijCli.
 *
 * These tests mock Bun.spawn to avoid requiring a real zellij installation.
 */

// Helper to create a mock spawn result
function makeMockProc(stdout: string, stderr: string, exitCode: number) {
  const stdoutStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(stdout));
      controller.close();
    },
  });
  const stderrStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(stderr));
      controller.close();
    },
  });

  return {
    stdout: stdoutStream,
    stderr: stderrStream,
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

describe("ZellijCli", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  describe("checkAvailability", () => {
    it("returns available=true with version when zellij is found", async () => {
      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc("zellij 0.41.2\n", "", 0));

      const cli = new ZellijCli();
      const result = await cli.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.version).toBe("0.41.2");

      Bun.spawn = originalSpawn;
    });

    it("returns available=false when zellij binary not found", async () => {
      Bun.spawn = mock(() => {
        throw new Error("spawn ENOENT");
      });

      const cli = new ZellijCli();
      const result = await cli.checkAvailability();

      expect(result.available).toBe(false);

      Bun.spawn = originalSpawn;
    });

    it("throws ZellijVersionError when version is too old", async () => {
      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc("zellij 0.39.0\n", "", 0));

      const cli = new ZellijCli();

      await expect(cli.checkAvailability()).rejects.toThrow(ZellijVersionError);
    });

    it("returns available=false on non-zero exit code", async () => {
      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc("", "segfault", 139));

      const cli = new ZellijCli();
      const result = await cli.checkAvailability();

      expect(result.available).toBe(false);
    });
  });

  describe("run", () => {
    it("returns stdout, stderr, and exitCode", async () => {
      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc("output\n", "", 0));

      const cli = new ZellijCli();
      const result = await cli.run(["--version"]);

      expect(result.stdout).toBe("output\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);

      Bun.spawn = originalSpawn;
    });
  });

  describe("listSessions", () => {
    it("parses session lines correctly", async () => {
      const output = [
        "my-session  2026-02-27 10:00:00 (ATTACHED)",
        "another-session  2026-02-27 11:00:00",
      ].join("\n");

      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc(output, "", 0));

      const cli = new ZellijCli();
      const sessions = await cli.listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.name).toBe("my-session");
      expect(sessions[0]?.attached).toBe(true);
      expect(sessions[1]?.name).toBe("another-session");
      expect(sessions[1]?.attached).toBe(false);

      Bun.spawn = originalSpawn;
    });

    it("returns empty array when no sessions", async () => {
      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc("No active zellij sessions found.", "", 1));

      const cli = new ZellijCli();
      const sessions = await cli.listSessions();

      expect(sessions).toHaveLength(0);

      Bun.spawn = originalSpawn;
    });
  });
});
