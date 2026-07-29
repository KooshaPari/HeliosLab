import { describe, expect, it, mock, beforeEach } from "bun:test";
import { TopologyTracker } from "../topology.js";
import type { ZellijCli } from "../cli.js";

/**
 * Unit tests for TopologyTracker.
 */

function makeMockCli(): ZellijCli {
  return {
    run: mock(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    checkAvailability: mock(async () => ({ available: true })),
    listSessions: mock(async () => []),
  } as unknown as ZellijCli;
}

describe("TopologyTracker", () => {
  let cli: ZellijCli;
  let tracker: TopologyTracker;

  beforeEach(() => {
    cli = makeMockCli();
    tracker = new TopologyTracker(cli);
  });

  describe("initializeTopology", () => {
    it("creates a topology with one tab and one pane", () => {
      const topo = tracker.initializeTopology("session-1");

      expect(topo.sessionName).toBe("session-1");
      expect(topo.tabs).toHaveLength(1);
      expect(topo.tabs[0]!.panes).toHaveLength(1);
      expect(topo.tabs[0]!.panes[0]!.focused).toBe(true);
      expect(topo.activeTabId).toBe(0);
    });

    it("uses custom initial dimensions", () => {
      const topo = tracker.initializeTopology("session-1", {
        cols: 120,
        rows: 40,
      });

      expect(topo.tabs[0]!.panes[0]!.dimensions).toEqual({
        cols: 120,
        rows: 40,
      });
    });
  });

  describe("addPane / removePane", () => {
    it("adds a pane to the active tab", () => {
      tracker.initializeTopology("s1");
      tracker.addPane("s1", 1, { cols: 40, rows: 24 }, "pty-1");

      const topo = tracker.getTopology("s1")!;
      const activeTab = topo.tabs.find(t => t.tabId === topo.activeTabId)!;
      expect(activeTab.panes).toHaveLength(2);

      const newPane = activeTab.panes.find(p => p.paneId === 1)!;
      expect(newPane.ptyId).toBe("pty-1");
      expect(newPane.focused).toBe(true);
      // Previous pane should be unfocused
      expect(activeTab.panes[0]!.focused).toBe(false);
    });

    it("removes a pane and refocuses", () => {
      tracker.initializeTopology("s1");
      tracker.addPane("s1", 1, { cols: 40, rows: 24 });
      tracker.removePane("s1", 1);

      const topo = tracker.getTopology("s1")!;
      const activeTab = topo.tabs.find(t => t.tabId === topo.activeTabId)!;
      expect(activeTab.panes).toHaveLength(1);
      expect(activeTab.panes[0]!.focused).toBe(true);
    });

    it("does nothing for unknown session", () => {
      tracker.addPane("unknown", 1, { cols: 80, rows: 24 });
      // Should not throw
    });
  });

  describe("updatePaneDimensions", () => {
    it("updates dimensions for an existing pane", () => {
      tracker.initializeTopology("s1");
      tracker.updatePaneDimensions("s1", 0, { cols: 100, rows: 50 });

      const pane = tracker.findPane("s1", 0)!;
      expect(pane.dimensions).toEqual({ cols: 100, rows: 50 });
    });
  });

  describe("bindPty", () => {
    it("binds a PTY ID to a pane", () => {
      tracker.initializeTopology("s1");
      tracker.bindPty("s1", 0, "pty-abc");

      const pane = tracker.findPane("s1", 0)!;
      expect(pane.ptyId).toBe("pty-abc");
    });
  });

  describe("tab operations", () => {
    it("adds and removes tabs", () => {
      tracker.initializeTopology("s1");
      tracker.addTab("s1", 1, "Second Tab");

      const topo = tracker.getTopology("s1")!;
      expect(topo.tabs).toHaveLength(2);
      expect(topo.activeTabId).toBe(1);

      tracker.removeTab("s1", 1);
      const updated = tracker.getTopology("s1")!;
      expect(updated.tabs).toHaveLength(1);
      expect(updated.activeTabId).toBe(0);
    });

    it("switches active tab", () => {
      tracker.initializeTopology("s1");
      tracker.addTab("s1", 1, "Tab 2");
      tracker.switchTab("s1", 0);

      expect(tracker.getTopology("s1")!.activeTabId).toBe(0);
    });
  });

  describe("refreshTopology", () => {
    it("returns minimal topology when CLI fails", async () => {
      (cli.run as ReturnType<typeof mock>).mockImplementation(async () => ({
        stdout: "",
        stderr: "error",
        exitCode: 1,
      }));

      const topo = await tracker.refreshTopology("s1");
      expect(topo.sessionName).toBe("s1");
      expect(topo.tabs).toHaveLength(1);
    });

    it("preserves PTY bindings after refresh", async () => {
      tracker.initializeTopology("s1");
      tracker.bindPty("s1", 0, "pty-preserved");

      const topo = await tracker.refreshTopology("s1");
      const pane = topo.tabs[0]?.panes.find(p => p.paneId === 0);
      expect(pane?.ptyId).toBe("pty-preserved");
    });
  });

  describe("getPtyBindings", () => {
    it("returns all PTY bindings for a session", () => {
      tracker.initializeTopology("s1");
      tracker.bindPty("s1", 0, "pty-1");
      tracker.addPane("s1", 1, { cols: 40, rows: 24 }, "pty-2");

      const bindings = tracker.getPtyBindings("s1");
      expect(bindings.size).toBe(2);
      expect(bindings.get(0)).toBe("pty-1");
      expect(bindings.get(1)).toBe("pty-2");
    });

    it("returns empty map for unknown session", () => {
      expect(tracker.getPtyBindings("unknown").size).toBe(0);
    });
  });

  describe("removeSession", () => {
    it("removes all topology data", () => {
      tracker.initializeTopology("s1");
      tracker.removeSession("s1");
      expect(tracker.getTopology("s1")).toBeUndefined();
    });
  });
});
