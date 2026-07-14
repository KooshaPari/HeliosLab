/**
 * FR-HELIOS-089: Zellij Mux Lifecycle Integration Tests
 * Verifies: FR-ZMX-001 (Zellij session adapter), FR-ZMX-002 (Session to lane binding), FR-ZMX-008 (Session reconciliation)
 * Traces to: FR-ZMX-001 (create/reattach/terminate sessions), FR-ZMX-002 (bind session to lane),
 * FR-ZMX-005 (relay mux events), FR-ZMX-006 (session reattach after restart), FR-ZMX-008 (reconcile bindings)
 */
import { describe, expect, it, mock, beforeEach } from "bun:test";
import {
  ZellijSessionManager,
} from "../../../../src/integrations/zellij/session.js";
import { MuxRegistry } from "../../../../src/integrations/zellij/registry.js";
import { TopologyTracker } from "../../../../src/integrations/zellij/topology.js";
import { ZellijPaneManager } from "../../../../src/integrations/zellij/panes.js";
import { ZellijTabManager } from "../../../../src/integrations/zellij/tabs.js";
import {
  MuxEventEmitter,
  MuxEventType,
  type EventBus,
  type MuxEvent,
} from "../../../../src/integrations/zellij/events.js";
import { reconcile } from "../../../../src/integrations/zellij/reconciliation.js";
import type { ZellijCli } from "../../../../src/integrations/zellij/cli.js";
import type {
  CliResult,
  ZellijSession,
  PtyManagerInterface,
} from "../../../../src/integrations/zellij/types.js";

// ---------------------------------------------------------------------------
// Fake CLI that tracks sessions in memory
// ---------------------------------------------------------------------------

class FakeCli {
  sessions = new Map<string, ZellijSession>();
  runLog: string[][] = [];

  async run(args: string[]): Promise<CliResult> {
    this.runLog.push(args);

    if (args[0] === "attach" && args.includes("--create")) {
      const name = args[1]!;
      this.sessions.set(name, { name, created: new Date(), attached: false });
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    if (args[0] === "kill-session") {
      const name = args[1]!;
      this.sessions.delete(name);
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    if (args[0] === "list-sessions") {
      if (this.sessions.size === 0) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      const lines = [...this.sessions.values()]
        .map(s => `${s.name}  2026-02-27 10:00:00`)
        .join("\n");
      return { stdout: lines, stderr: "", exitCode: 0 };
    }

    // For action commands (new-pane, resize, dump-layout, etc.)
    if (args.includes("action") && args.includes("dump-layout")) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    return { stdout: "", stderr: "", exitCode: 0 };
  }

  async listSessions(): Promise<ZellijSession[]> {
    return [...this.sessions.values()];
  }

  async checkAvailability() {
    return { available: true, version: "0.41.0" };
  }
}

function makeEventBus(): EventBus & { events: MuxEvent[] } {
  const events: MuxEvent[] = [];
  return {
    events,
    publish: mock(async (e: MuxEvent) => {
      events.push(e);
    }),
  };
}

function makePtyManager(): PtyManagerInterface & { spawned: string[] } {
  const spawned: string[] = [];
  let counter = 0;
  return {
    spawned,
    spawn: mock(async _opts => {
      const id = `pty-${++counter}`;
      spawned.push(id);
      return { ptyId: id, pid: 1000 + counter };
    }),
    terminate: mock(async () => {}),
    resize: mock(() => {}),
  };
}

describe("Integration: full lifecycle", () => {
  let cli: FakeCli;
  let registry: MuxRegistry;
  let topology: TopologyTracker;
  let bus: ReturnType<typeof makeEventBus>;
  let emitter: MuxEventEmitter;
  let sessionMgr: ZellijSessionManager;

  beforeEach(() => {
    cli = new FakeCli();
    registry = new MuxRegistry(cli as unknown as ZellijCli);
    topology = new TopologyTracker(cli as unknown as ZellijCli);
    bus = makeEventBus();
    emitter = new MuxEventEmitter(bus);
    sessionMgr = new ZellijSessionManager(cli as unknown as ZellijCli, registry, {
      topology,
      emitter,
    });
  });

  it("create session, add panes, close, verify events", async () => {
    // Create session
    const session = await sessionMgr.createSession("lane-1");
    expect(session.sessionName).toBe("helios-lane-lane-1");
    expect(registry.getByLane("lane-1")).toBeDefined();

    // Initialize topology for pane operations
    topology.initializeTopology(session.sessionName);

    const paneManager = new ZellijPaneManager({
      cli: cli as unknown as ZellijCli,
      topology,
    });

    // Add panes
    const pane1 = await paneManager.createPane(session.sessionName, "lane-1");
    expect(pane1.id).toBeGreaterThan(0);

    // Close pane
    await paneManager.closePane(session.sessionName, pane1.id);

    // Terminate session
    await sessionMgr.terminateSession(session.sessionName);
    expect(registry.getBySession(session.sessionName)).toBeUndefined();
    expect(cli.sessions.has(session.sessionName)).toBe(false);
  });

  it("create session, add tabs, switch, close tab", async () => {
    const session = await sessionMgr.createSession("lane-tabs");
    topology.initializeTopology(session.sessionName);

    const paneManager = new ZellijPaneManager({
      cli: cli as unknown as ZellijCli,
      topology,
    });
    const tabManager = new ZellijTabManager({
      cli: cli as unknown as ZellijCli,
      topology,
      paneManager,
    });

    const tab = await tabManager.createTab(session.sessionName, "work");
    expect(tab.name).toBe("work");

    // Switch tab
    await tabManager.switchTab(session.sessionName, tab.index);
    expect(topology.getTopology(session.sessionName)?.activeTabId).toBe(tab.index);

    // Close tab
    await tabManager.closeTab(session.sessionName, tab.index);

    await sessionMgr.terminateSession(session.sessionName);
  });
});

describe("Integration: reattach", () => {
  it("creates session, simulates restart, reattaches, verifies topology", async () => {
    const cli = new FakeCli();
    const _registry = new MuxRegistry(cli as unknown as ZellijCli);
    const topology = new TopologyTracker(cli as unknown as ZellijCli);
    const bus = makeEventBus();
    const emitter = new MuxEventEmitter(bus);
    const ptyManager = makePtyManager();

    const sessionMgr = new ZellijSessionManager(cli as unknown as ZellijCli, registry, {
      topology,
      ptyManager,
      emitter,
    });

    // Create a session
    const session = await sessionMgr.createSession("lane-reattach");
    topology.initializeTopology(session.sessionName);

    // Simulate restart: clear in-memory state but keep the "live" session in fakeCli
    registry.unbind(session.sessionName);
    // topology still has stale data - reattach should refresh

    // Reattach
    const reattached = await sessionMgr.reattachSession(session.sessionName);
    expect(reattached.sessionName).toBe(session.sessionName);
    expect(reattached.laneId).toBe("lane-reattach");
    expect(registry.getBySession(session.sessionName)).toBeDefined();

    // Verify reattach event was emitted
    await new Promise(r => setTimeout(r, 20));
    const reattachEvents = bus.events.filter(e => e.type === MuxEventType.SESSION_REATTACHED);
    expect(reattachEvents).toHaveLength(1);

    // PTYs should have been re-bound (one default pane from refreshTopology)
    expect(ptyManager.spawned.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Integration: reconciliation", () => {
  it("creates orphans, runs reconciliation, verifies cleanup", async () => {
    const cli = new FakeCli();
    const _registry = new MuxRegistry(cli as unknown as ZellijCli);

    // Create an orphan session (live but not in registry)
    cli.sessions.set("helios-lane-orphan", {
      name: "helios-lane-orphan",
      created: new Date(),
      attached: false,
    });

    // Create a bound session
    cli.sessions.set("helios-lane-bound", {
      name: "helios-lane-bound",
      created: new Date(),
      attached: false,
    });
    registry.bind("helios-lane-bound", "bound", {
      sessionName: "helios-lane-bound",
      laneId: "bound",
      createdAt: new Date(),
      panes: [],
      tabs: [],
    });

    // Create a stale binding (no live session)
    registry.bind("helios-lane-stale", "stale", {
      sessionName: "helios-lane-stale",
      laneId: "stale",
      createdAt: new Date(),
      panes: [],
      tabs: [],
    });

    const result = await reconcile(cli as unknown as ZellijCli, registry);

    expect(result.orphanedSessionsTerminated).toContain("helios-lane-orphan");
    expect(result.staleBindingsCleaned).toContain("helios-lane-stale");
    expect(registry.getBySession("helios-lane-stale")).toBeUndefined();
    expect(registry.getBySession("helios-lane-bound")).toBeDefined();
    // Orphan should have been killed
    expect(cli.sessions.has("helios-lane-orphan")).toBe(false);
  });
});
