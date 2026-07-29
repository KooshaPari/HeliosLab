import { describe, it, expect, beforeEach } from "bun:test";
import { TerminalTab } from "../../../src/tabs/terminal_tab";
import type { ActiveContext } from "../../../src/tabs/context_switch";

describe("TerminalTab", () => {
  let tab: TerminalTab;

  beforeEach(() => {
    tab = new TerminalTab();
  });

  describe("Initialization", () => {
    it("should create with correct properties", () => {
      expect(tab.getTabId()).toBe("terminal-tab");
      expect(tab.getTabType()).toBe("terminal");
      expect(tab.getLabel()).toBe("Terminal");
    });

    it("should start with no terminal", async () => {
      await tab.onContextChange(null);
      expect(tab.render().textContent).toContain("No terminal");
    });
  });

  describe("Context Binding", () => {
    it("should update on context change", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();

      // Should render terminal output after context change
      expect(el.textContent).toContain("$");
    });

    it("should clear on null context", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      await tab.onContextChange(null);

      const el = tab.render();
      expect(el.textContent).toContain("No terminal");
    });

    it("should handle context changes with different lane IDs", async () => {
      const context1: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      const context2: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane2",
        sessionId: "session1",
      };

      await tab.onContextChange(context1);
      const el1 = tab.render();
      expect(el1.textContent).toContain("lane1");

      await tab.onContextChange(context2);
      const el2 = tab.render();
      expect(el2.textContent).toContain("lane2");
    });
  });

  describe("Empty State", () => {
    it("should show empty state message when no terminal", async () => {
      await tab.onContextChange(null);
      const el = tab.render();

      expect(el.textContent).toContain("No terminal for this lane");
    });

    it("should show create button in empty state", async () => {
      await tab.onContextChange(null);
      const el = tab.render();
      const btn = el.querySelector("button");

      expect(btn).toBeDefined();
      expect(btn?.textContent).toContain("Create Terminal");
    });
  });

  describe("Rendering", () => {
    it("should render terminal prompt", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();

      expect(el.textContent).toContain("$");
    });

    it("should have input field for commands", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      const input = el.querySelector("input");

      expect(input).toBeDefined();
      expect(input?.type).toBe("text");
    });
  });

  describe("Renderer Switch", () => {
    it("should show loading indicator during renderer switch", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      tab.setRendererSwitchInProgress(true);
      const el = tab.render();

      expect(el.textContent).toContain("Switching renderer");
    });

    it("should hide loading indicator after renderer switch completes", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      tab.setRendererSwitchInProgress(true);
      tab.setRendererSwitchInProgress(false);
      const el = tab.render();

      expect(el.textContent).not.toContain("Switching renderer");
    });
  });

  describe("State Persistence", () => {
    it("should serialize state", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const state = tab.getState();

      expect(state.tabId).toBe("terminal-tab");
      expect(state.tabType).toBe("terminal");
      expect(state.terminalId).toBeDefined();
    });

    it("should restore state", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const originalState = tab.getState();

      const newTab = new TerminalTab();
      newTab.restoreState(originalState);
      const restoredState = newTab.getState();

      expect(restoredState.tabId).toBe(originalState.tabId);
      expect(restoredState.tabType).toBe(originalState.tabType);
    });

    it("should preserve terminal ID across restores", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const state = tab.getState();
      const terminalId = state.terminalId;

      const newTab = new TerminalTab();
      newTab.restoreState(state);

      expect(newTab.getState().terminalId).toBe(terminalId);
    });
  });

  describe("Lifecycle", () => {
    it("should handle activation", () => {
      tab.onActivate();
      expect(tab.getIsActive()).toBe(true);
    });

    it("should handle deactivation", () => {
      tab.onActivate();
      tab.onDeactivate();
      expect(tab.getIsActive()).toBe(false);
    });

    it("should handle multiple lifecycle transitions", () => {
      tab.onActivate();
      expect(tab.getIsActive()).toBe(true);

      tab.onDeactivate();
      expect(tab.getIsActive()).toBe(false);

      tab.onActivate();
      expect(tab.getIsActive()).toBe(true);
    });
  });
});
