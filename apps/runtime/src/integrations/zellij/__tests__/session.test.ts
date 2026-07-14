import { ZellijCli } from "../cli.js";
import { MuxRegistry } from "../registry.js";
import { ZellijSessionManager, sessionNameForLane } from "../session.js";
import { SessionAlreadyExistsError, SessionNotFoundError } from "../errors.js";

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

describe("sessionNameForLane", () => {
  it("generates correct session name", () => {
    expect(sessionNameForLane("abc-123")).toBe("helios-lane-abc-123");
  });
});

describe("ZellijSessionManager", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  describe("createSession", () => {
    it("creates a session and registers binding", async () => {
      let callCount = 0;
      // @ts-expect-error mock override
      Bun.spawn = mock(() => {
        callCount++;
        if (callCount === 1) {
          // listSessions - no existing sessions
          return makeMockProc("", "", 0);
        }
        if (callCount === 2) {
          // attach --create
          return makeMockProc("", "", 0);
        }
        // listSessions after create - session now exists
        return makeMockProc("helios-lane-test-1  2026-02-27 10:00:00", "", 0);
      });

      const cli = new ZellijCli();
      const _registry = new MuxRegistry();
      const manager = new ZellijSessionManager(cli, registry);

      const session = await manager.createSession("test-1");

      expect(session.sessionName).toBe("helios-lane-test-1");
      expect(session.laneId).toBe("test-1");
      expect(registry.getByLane("test-1")).toBeDefined();

      Bun.spawn = originalSpawn;
    });

    it("throws SessionAlreadyExistsError if session exists", async () => {
      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc("helios-lane-dup  2026-02-27 10:00:00", "", 0));

      const cli = new ZellijCli();
      const _registry = new MuxRegistry();
      const manager = new ZellijSessionManager(cli, registry);

      await expect(manager.createSession("dup")).rejects.toThrow(SessionAlreadyExistsError);
    });
  });

  describe("reattachSession", () => {
    it("reattaches to an existing session", async () => {
      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc("helios-lane-reattach  2026-02-27 10:00:00", "", 0));

      const cli = new ZellijCli();
      const _registry = new MuxRegistry();
      const manager = new ZellijSessionManager(cli, registry);

      const session = await manager.reattachSession("helios-lane-reattach");

      expect(session.sessionName).toBe("helios-lane-reattach");
      expect(session.laneId).toBe("reattach");
      expect(registry.getBySession("helios-lane-reattach")).toBeDefined();

      Bun.spawn = originalSpawn;
    });

    it("throws SessionNotFoundError if session does not exist", async () => {
      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc("", "", 0));

      const cli = new ZellijCli();
      const _registry = new MuxRegistry();
      const manager = new ZellijSessionManager(cli, registry);

      await expect(manager.reattachSession("helios-lane-missing")).rejects.toThrow(
        SessionNotFoundError
      );
    });
  });

  describe("terminateSession", () => {
    it("terminates a session and unbinds", async () => {
      let callCount = 0;
      // @ts-expect-error mock override
      Bun.spawn = mock(() => {
        callCount++;
        if (callCount <= 2) {
          // listSessions for reattach (called twice - panes + tabs query may also call)
          return makeMockProc("helios-lane-term  2026-02-27 10:00:00", "", 0);
        }
        if (callCount <= 5) {
          // kill-session or subsequent listSessions (empty)
          return makeMockProc("", "", 0);
        }
        return makeMockProc("", "", 0);
      });

      const cli = new ZellijCli();
      const _registry = new MuxRegistry();
      const manager = new ZellijSessionManager(cli, registry);

      // First reattach to bind it
      await manager.reattachSession("helios-lane-term");
      expect(registry.getBySession("helios-lane-term")).toBeDefined();

      // Now terminate
      await manager.terminateSession("helios-lane-term");
      expect(registry.getBySession("helios-lane-term")).toBeUndefined();

      Bun.spawn = originalSpawn;
    });

    it("is idempotent for non-existent sessions", async () => {
      // @ts-expect-error mock override
      Bun.spawn = mock(() => makeMockProc("", "No session named 'foo' found.", 1));

      const cli = new ZellijCli();
      const _registry = new MuxRegistry();
      const manager = new ZellijSessionManager(cli, registry);

      // Should not throw
      await manager.terminateSession("foo");

      Bun.spawn = originalSpawn;
    });
  });
});
