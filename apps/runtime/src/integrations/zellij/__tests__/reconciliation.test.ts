
import { reconcile } from "../reconciliation.js";
import { MuxRegistry } from "../registry.js";
import type { ZellijCli } from "../cli.js";
import type { CliResult, ZellijSession, MuxSession } from "../types.js";

function makeSession(name: string, attached = false): ZellijSession {
  return { name, created: new Date(), attached };
}

function makeMuxSession(sessionName: string, laneId: string): MuxSession {
  return {
    sessionName,
    laneId,
    createdAt: new Date(),
    panes: [],
    tabs: [],
  };
}

function makeCli(sessions: ZellijSession[], killResults?: Map<string, CliResult>): ZellijCli {
  return {
    listSessions: mock(async () => sessions),
    run: mock(async (args: string[]) => {
      if (args[0] === "kill-session") {
        const name = args[1]!;
        return killResults?.get(name) ?? { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
    checkAvailability: mock(async () => ({ available: true })),
  } as unknown as ZellijCli;
}

describe("reconcile", () => {
  it("terminates orphaned helios sessions", async () => {
    const cli = makeCli([
      makeSession("helios-lane-orphan1"),
      makeSession("helios-lane-bound"),
      makeSession("other-session"), // not helios-prefixed, should be ignored
    ]);
    const _registry = new MuxRegistry();
    registry.bind("helios-lane-bound", "bound", makeMuxSession("helios-lane-bound", "bound"));

    const result = await reconcile(cli, registry);

    expect(result.orphanedSessionsTerminated).toEqual(["helios-lane-orphan1"]);
    expect(result.staleBindingsCleaned).toEqual([]);
    expect(result.liveSessionCount).toBe(3);
    expect(result.registryBindingCount).toBe(1);
  });

  it("cleans up stale registry entries for dead sessions", async () => {
    const cli = makeCli([]); // no live sessions
    const _registry = new MuxRegistry();
    registry.bind("helios-lane-dead", "dead", makeMuxSession("helios-lane-dead", "dead"));

    const result = await reconcile(cli, registry);

    expect(result.staleBindingsCleaned).toEqual(["helios-lane-dead"]);
    expect(registry.getBySession("helios-lane-dead")).toBeUndefined();
  });

  it("handles mixed orphans and stale bindings", async () => {
    const cli = makeCli([makeSession("helios-lane-orphan"), makeSession("helios-lane-alive")]);
    const _registry = new MuxRegistry();
    registry.bind("helios-lane-alive", "alive", makeMuxSession("helios-lane-alive", "alive"));
    registry.bind("helios-lane-gone", "gone", makeMuxSession("helios-lane-gone", "gone"));

    const result = await reconcile(cli, registry);

    expect(result.orphanedSessionsTerminated).toEqual(["helios-lane-orphan"]);
    expect(result.staleBindingsCleaned).toEqual(["helios-lane-gone"]);
  });

  it("is idempotent - running twice with same state yields same results", async () => {
    const cli = makeCli([makeSession("helios-lane-bound")]);
    const _registry = new MuxRegistry();
    registry.bind("helios-lane-bound", "bound", makeMuxSession("helios-lane-bound", "bound"));

    const r1 = await reconcile(cli, registry);
    const r2 = await reconcile(cli, registry);

    expect(r1.orphanedSessionsTerminated).toEqual([]);
    expect(r1.staleBindingsCleaned).toEqual([]);
    expect(r2.orphanedSessionsTerminated).toEqual([]);
    expect(r2.staleBindingsCleaned).toEqual([]);
  });

  it("returns zero counts when everything is clean", async () => {
    const cli = makeCli([]);
    const _registry = new MuxRegistry();

    const result = await reconcile(cli, registry);

    expect(result.orphanedSessionsTerminated).toEqual([]);
    expect(result.staleBindingsCleaned).toEqual([]);
    expect(result.liveSessionCount).toBe(0);
    expect(result.registryBindingCount).toBe(0);
  });

  it("counts kill failure as not terminated if unexpected error", async () => {
    const killResults = new Map<string, CliResult>();
    killResults.set("helios-lane-stubborn", {
      stdout: "",
      stderr: "unexpected error",
      exitCode: 1,
    });

    const cli = makeCli([makeSession("helios-lane-stubborn")], killResults);
    const _registry = new MuxRegistry();

    const result = await reconcile(cli, registry);

    // Kill returned non-zero without "not found" - not counted as terminated
    expect(result.orphanedSessionsTerminated).toEqual([]);
  });
});
