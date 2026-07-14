/**
 * T016 - Stress and edge case tests.
 */


import { ZellijSessionManager } from "../../../../src/integrations/zellij/session.js";
import { MuxRegistry } from "../../../../src/integrations/zellij/registry.js";
import { TopologyTracker } from "../../../../src/integrations/zellij/topology.js";
import { ZellijPaneManager } from "../../../../src/integrations/zellij/panes.js";
import {
  MuxEventEmitter,
  type EventBus,
  type MuxEvent,
} from "../../../../src/integrations/zellij/events.js";
import { reconcile } from "../../../../src/integrations/zellij/reconciliation.js";
import type { ZellijCli } from "../../../../src/integrations/zellij/cli.js";
import type { CliResult, ZellijSession } from "../../../../src/integrations/zellij/types.js";

// Reuse the FakeCli pattern
class FakeCli {
  sessions = new Map<string, ZellijSession>();

  async run(args: string[]): Promise<CliResult> {
    if (args[0] === "attach" && args.includes("--create")) {
      const name = args[1]!;
      this.sessions.set(name, { name, created: new Date(), attached: false });
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (args[0] === "kill-session") {
      this.sessions.delete(args[1]!);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (args[0] === "list-sessions") {
      if (this.sessions.size === 0) return { stdout: "", stderr: "", exitCode: 0 };
      const lines = [...this.sessions.values()]
        .map(s => `${s.name}  2026-02-27 10:00:00`)
        .join("\n");
      return { stdout: lines, stderr: "", exitCode: 0 };
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

describe("Stress: rapid pane create/close cycles", () => {
  it("handles 50 rapid create-close cycles without state corruption", async () => {
    const cli = new FakeCli();
    const _registry = new MuxRegistry(cli as unknown as ZellijCli);
    const topology = new TopologyTracker(cli as unknown as ZellijCli);
    const sessionMgr = new ZellijSessionManager(cli as unknown as ZellijCli, registry);

    const session = await sessionMgr.createSession("rapid-lane");
    topology.initializeTopology(session.sessionName);

    const paneManager = new ZellijPaneManager({
      cli: cli as unknown as ZellijCli,
      topology,
    });

    const createdIds: number[] = [];
    for (let i = 0; i < 50; i++) {
      const pane = await paneManager.createPane(session.sessionName, "rapid-lane");
      createdIds.push(pane.id);
    }

    expect(createdIds).toHaveLength(50);
    // All IDs should be unique
    expect(new Set(createdIds).size).toBe(50);

    // Close all panes
    for (const id of createdIds) {
      await paneManager.closePane(session.sessionName, id);
    }

    // Topology should still be valid
    const topo = topology.getTopology(session.sessionName);
    expect(topo).toBeDefined();
  });
});

describe("Stress: multiple sessions with shared lane IDs", () => {
  it("prevents duplicate lane bindings", async () => {
    const cli = new FakeCli();
    const _registry = new MuxRegistry(cli as unknown as ZellijCli);
    const sessionMgr = new ZellijSessionManager(cli as unknown as ZellijCli, registry);

    await sessionMgr.createSession("shared-lane");

    // Attempting to create another session with the same lane should fail
    // (SessionAlreadyExistsError because the session name is deterministic)
    await expect(sessionMgr.createSession("shared-lane")).rejects.toThrow();
  });

  it("allows reuse of lane ID after session termination", async () => {
    const cli = new FakeCli();
    const _registry = new MuxRegistry(cli as unknown as ZellijCli);
    const sessionMgr = new ZellijSessionManager(cli as unknown as ZellijCli, registry);

    const s1 = await sessionMgr.createSession("reuse-lane");
    await sessionMgr.terminateSession(s1.sessionName);

    // Should succeed now
    const s2 = await sessionMgr.createSession("reuse-lane");
    expect(s2.sessionName).toBe(s1.sessionName);
  });
});

describe("Stress: reattach with modified topology", () => {
  it("reattaches after topology has changed", async () => {
    const cli = new FakeCli();
    const _registry = new MuxRegistry(cli as unknown as ZellijCli);
    const topology = new TopologyTracker(cli as unknown as ZellijCli);
    const bus: EventBus & { events: MuxEvent[] } = {
      events: [],
      publish: mock(async (e: MuxEvent) => {
        bus.events.push(e);
      }),
    };
    const emitter = new MuxEventEmitter(bus);
    const sessionMgr = new ZellijSessionManager(cli as unknown as ZellijCli, registry, {
      topology,
      emitter,
    });

    // Create session and modify topology
    const session = await sessionMgr.createSession("topo-lane");
    topology.initializeTopology(session.sessionName);

    // Add extra panes to topology to simulate changed state
    topology.addPane(session.sessionName, 100, { cols: 40, rows: 12 });
    topology.addPane(session.sessionName, 101, { cols: 40, rows: 12 });
    topology.addTab(session.sessionName, 1, "Extra Tab");

    // Simulate restart
    registry.unbind(session.sessionName);

    // Reattach - topology will be refreshed from cli (which returns minimal)
    const reattached = await sessionMgr.reattachSession(session.sessionName);
    expect(reattached.sessionName).toBe(session.sessionName);
    expect(registry.getBySession(session.sessionName)).toBeDefined();

    // Verify reattach event
    await new Promise(r => setTimeout(r, 20));
    expect(bus.events.some(e => e.type === "mux.session.reattached")).toBe(true);
  });
});

describe("Stress: reconciliation with many sessions", () => {
  it("handles 100 orphaned sessions", async () => {
    const cli = new FakeCli();
    const _registry = new MuxRegistry(cli as unknown as ZellijCli);

    // Create 100 orphaned sessions
    for (let i = 0; i < 100; i++) {
      cli.sessions.set(`helios-lane-orphan-${i}`, {
        name: `helios-lane-orphan-${i}`,
        created: new Date(),
        attached: false,
      });
    }

    const result = await reconcile(cli as unknown as ZellijCli, registry);
    expect(result.orphanedSessionsTerminated).toHaveLength(100);
    expect(cli.sessions.size).toBe(0);
  });
});
