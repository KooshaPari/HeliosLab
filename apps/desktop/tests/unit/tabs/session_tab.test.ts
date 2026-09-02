import { describe, it, expect, beforeEach } from "bun:test";
import { SessionTab } from "../../../src/tabs/session_tab";
import type { ActiveContext } from "../../../src/tabs/context_switch";

describe("SessionTab", () => {
  let tab: SessionTab;

  beforeEach(() => {
    tab = new SessionTab();
  });

  describe("Initialization", () => {
    it("should create with correct properties", () => {
      expect(tab.getTabId()).toBe("session-tab");
      expect(tab.getTabType()).toBe("session");
      expect(tab.getLabel()).toBe("Session");
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
      expect(el.textContent).toContain("Session Information");
    });

    it("should show empty state on null context", async () => {
      await tab.onContextChange(null);
      const el = tab.render();
      expect(el.textContent).toContain("No active session");
    });
  });

  describe("Metadata Display", () => {
    it("should display session ID", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session123",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("session123");
    });

    it("should display terminal count", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Terminal Count");
    });

    it("should display lifecycle state", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Lifecycle State");
    });
  });

  describe("Diagnostics", () => {
    it("should display transport mode", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Harness Transport");
    });

    it("should show diagnostics section", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Diagnostics");
    });
  });

  describe("Timeline", () => {
    it("should display timeline events", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Timeline");
    });

    it("should show session creation event", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Session created");
    });
  });

  describe("Expandable Sections", () => {
    it("should toggle section expansion", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const state = tab.getState();

      expect(state.expandedSections).toBeDefined();
      expect(Array.isArray(state.expandedSections)).toBe(true);
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

      expect(state.tabType).toBe("session");
      expect(state.expandedSections).toBeDefined();
    });

    it("should restore state", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const originalState = tab.getState();

      const newTab = new SessionTab();
      newTab.restoreState(originalState);

      expect(newTab.getState().expandedSections).toEqual(originalState.expandedSections);
    });
  });

  describe("Lifecycle", () => {
    it("should handle activation and deactivation", () => {
      tab.onActivate();
      expect(tab.getIsActive()).toBe(true);

      tab.onDeactivate();
      expect(tab.getIsActive()).toBe(false);
    });
  });
});
