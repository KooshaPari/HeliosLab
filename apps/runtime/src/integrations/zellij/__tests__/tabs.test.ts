import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ZellijTabManager } from "../tabs.js";
import { ZellijPaneManager } from "../panes.js";
import { TopologyTracker } from "../topology.js";
import { TabNotFoundError } from "../errors.js";
import type { ZellijCli } from "../cli.js";
import type { PtyManagerInterface } from "../types.js";

/**
 * Unit tests for ZellijTabManager.
 */

function makeMockCli(): ZellijCli {
  return {
    run: mock(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    checkAvailability: mock(async () => ({
      available: true,
      version: "0.41.2",
    })),
    listSessions: mock(async () => []),
  } as unknown as ZellijCli;
}

function makeMockPtyManager(): PtyManagerInterface {
  return {
    spawn: mock(async () => ({ ptyId: "pty-1", pid: 1001 })),
    terminate: mock(async () => {}),
    resize: mock(() => {}),
  };
}

describe("ZellijTabManager", () => {
  let cli: ZellijCli;
  let topology: TopologyTracker;
  let paneManager: ZellijPaneManager;
  let ptyManager: PtyManagerInterface;
  let tabManager: ZellijTabManager;

  beforeEach(() => {
    cli = makeMockCli();
    topology = new TopologyTracker(cli);
    ptyManager = makeMockPtyManager();
    paneManager = new ZellijPaneManager({ cli, topology, ptyManager });
    tabManager = new ZellijTabManager({
      cli,
      topology,
      paneManager,
      ptyManager,
    });
  });

  describe("createTab", () => {
    it("creates a tab with a name and returns a record", async () => {
      topology.initializeTopology("test-session");
      const record = await tabManager.createTab("test-session", "my-tab");

      expect(record.index).toBeGreaterThan(0);
      expect(record.name).toBe("my-tab");
      expect(record.panes).toHaveLength(1);
      expect(record.createdAt).toBeInstanceOf(Date);
    });

    it("creates a tab with a default name", async () => {
      topology.initializeTopology("test-session");
      const record = await tabManager.createTab("test-session");

      expect(record.name).toMatch(/Tab #\d+/);
    });

    it("calls zellij CLI with correct args", async () => {
      topology.initializeTopology("test-session");
      await tabManager.createTab("test-session", "work");

      const runMock = cli.run as ReturnType<typeof mock>;
      const callArgs = runMock.mock.calls[0]![0] as string[];
      expect(callArgs).toContain("new-tab");
      expect(callArgs).toContain("--name");
      expect(callArgs).toContain("work");
    });

    it("updates topology with new tab", async () => {
      topology.initializeTopology("test-session");
      const record = await tabManager.createTab("test-session", "new-tab");

      const topo = topology.getTopology("test-session");
      expect(topo?.tabs).toHaveLength(2); // initial + new
      expect(topo?.activeTabId).toBe(record.index);
    });
  });

  describe("closeTab", () => {
    it("closes a tab and terminates PTYs", async () => {
      topology.initializeTopology("test-session");
      const record = await tabManager.createTab("test-session", "to-close");

      // Bind a PTY to the default pane in the new tab
      const topo = topology.getTopology("test-session")!;
      const newTab = topo.tabs.find(t => t.tabId === record.index)!;
      if (newTab.panes[0]) {
        topology.bindPty("test-session", newTab.panes[0].paneId, "pty-tab-1");
      }

      await tabManager.closeTab("test-session", record.index);

      expect(ptyManager.terminate).toHaveBeenCalledWith("pty-tab-1");
      const updated = topology.getTopology("test-session")!;
      expect(updated.tabs.find(t => t.tabId === record.index)).toBeUndefined();
    });

    it("throws TabNotFoundError for non-existent tab", async () => {
      topology.initializeTopology("test-session");

      expect(tabManager.closeTab("test-session", 999)).rejects.toThrow(TabNotFoundError);
    });

    it("throws TabNotFoundError for non-existent session", async () => {
      expect(tabManager.closeTab("no-session", 0)).rejects.toThrow(TabNotFoundError);
    });
  });

  describe("switchTab", () => {
    it("switches to a valid tab", async () => {
      topology.initializeTopology("test-session");
      const record = await tabManager.createTab("test-session", "second");

      await tabManager.switchTab("test-session", record.index);

      const topo = topology.getTopology("test-session")!;
      expect(topo.activeTabId).toBe(record.index);
    });

    it("throws TabNotFoundError for non-existent tab", async () => {
      topology.initializeTopology("test-session");

      expect(tabManager.switchTab("test-session", 999)).rejects.toThrow(TabNotFoundError);
    });
  });

  describe("getActiveTab", () => {
    it("returns the active tab ID", async () => {
      topology.initializeTopology("test-session");
      expect(tabManager.getActiveTab("test-session")).toBe(0);

      const record = await tabManager.createTab("test-session", "new");
      expect(tabManager.getActiveTab("test-session")).toBe(record.index);
    });

    it("returns undefined for unknown session", () => {
      expect(tabManager.getActiveTab("unknown")).toBeUndefined();
    });
  });
});
