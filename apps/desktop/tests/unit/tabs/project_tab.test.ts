import { describe, it, expect, beforeEach } from "bun:test";
import { ProjectTab } from "../../../src/tabs/project_tab";
import type { ActiveContext } from "../../../src/tabs/context_switch";

describe("ProjectTab", () => {
  let tab: ProjectTab;

  beforeEach(() => {
    tab = new ProjectTab();
  });

  describe("Initialization", () => {
    it("should create with correct properties", () => {
      expect(tab.getTabId()).toBe("project-tab");
      expect(tab.getTabType()).toBe("project");
      expect(tab.getLabel()).toBe("Project");
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
      expect(el.textContent).toContain("Project Information");
    });

    it("should show unavailable state on null context", async () => {
      await tab.onContextChange(null);
      const el = tab.render();
      expect(el.textContent).toContain("Workspace Unavailable");
    });
  });

  describe("Project Information", () => {
    it("should display project name", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Helios");
    });

    it("should display workspace path", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("workspace");
    });

    it("should display active lanes count", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Active Lanes");
    });
  });

  describe("Lanes Display", () => {
    it("should display lanes section", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Lanes");
    });

    it("should show lane information", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Current Lane");
    });

    it("should display lane states", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("active");
    });
  });

  describe("Git Status", () => {
    it("should display git status if available", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Git Status");
    });
  });

  describe("Quick Actions", () => {
    it("should have quick actions section", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      expect(el.textContent).toContain("Quick Actions");
    });

    it("should have create lane action", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      const button = Array.from(el.querySelectorAll("button")).find(b =>
        b.textContent?.includes("Create New Lane")
      );

      expect(button).toBeDefined();
    });

    it("should have open in file manager action", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const el = tab.render();
      const button = Array.from(el.querySelectorAll("button")).find(b =>
        b.textContent?.includes("Open in File Manager")
      );

      expect(button).toBeDefined();
    });
  });

  describe("Error State", () => {
    it("should show error on unavailable workspace", async () => {
      await tab.onContextChange(null);
      const el = tab.render();

      expect(el.textContent).toContain("Workspace Unavailable");
    });

    it("should have retry button on error", async () => {
      await tab.onContextChange(null);
      const el = tab.render();
      const button = el.querySelector("button");

      expect(button?.textContent).toContain("Retry");
    });
  });

  describe("Expandable Sections", () => {
    it("should support expandable sections", async () => {
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

      expect(state.tabType).toBe("project");
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

      const newTab = new ProjectTab();
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
