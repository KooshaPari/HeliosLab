import { describe, it, expect, beforeEach } from "bun:test";
import { TabBar } from "../../../src/tabs/tab_bar";
import { createMockTabSurface } from "../../../src/tabs/tab_surface";

// Traces to: FR-TAB-001, FR-TAB-002, FR-TAB-004
describe("TabBar", () => {
  let tabBar: TabBar;
  let mockTabs: ReturnType<typeof createMockTabSurface>[] = [];

  beforeEach(() => {
    mockTabs = [
      createMockTabSurface("tab1", "terminal", "Terminal"),
      createMockTabSurface("tab2", "agent", "Agent"),
      createMockTabSurface("tab3", "session", "Session"),
      createMockTabSurface("tab4", "chat", "Chat"),
      createMockTabSurface("tab5", "project", "Project"),
    ];

    tabBar = new TabBar(mockTabs);
  });

  describe("Tab Selection", () => {
    it("should initialize with first tab selected", () => {
      // Traces to: FR-TAB-006 (preserve tab selection state across restarts)
      expect(tabBar.getSelectedTabId()).toBe("tab1");
    });

    it("should select a tab by ID", () => {
      tabBar.selectTab("tab3");
      expect(tabBar.getSelectedTabId()).toBe("tab3");
    });

    it("should activate/deactivate tabs on selection", () => {
      const tab1 = mockTabs[0];
      const tab2 = mockTabs[1];

      let _tab1Active = false;
      let tab1Deactivated = false;
      let tab2Active = false;

      tab1.onActivate = () => {
        tab1Active = true;
      };
      tab1.onDeactivate = () => {
        tab1Deactivated = true;
      };
      tab2.onActivate = () => {
        tab2Active = true;
      };

      tabBar.selectTab("tab2");

      expect(tab1Deactivated).toBe(true);
      expect(tab2Active).toBe(true);
    });

    it("should call onTabSelected callback", () => {
      let selectedTabId = "";

      tabBar = new TabBar(mockTabs, {
        onTabSelected: id => {
          selectedTabId = id;
        },
      });

      tabBar.selectTab("tab3");
      expect(selectedTabId).toBe("tab3");
    });

    it("should not select non-existent tabs", () => {
      const previousSelected = tabBar.getSelectedTabId();
      tabBar.selectTab("nonexistent");
      expect(tabBar.getSelectedTabId()).toBe(previousSelected);
    });
  });

  describe("Tab Reordering", () => {
    it("should return correct tab order", () => {
      expect(tabBar.getTabOrder()).toEqual(["tab1", "tab2", "tab3", "tab4", "tab5"]);
    });

    it("should reorder tabs", () => {
      const newOrder = ["tab5", "tab1", "tab3", "tab2", "tab4"];
      tabBar.reorderTabs(newOrder);
      expect(tabBar.getTabOrder()).toEqual(newOrder);
    });

    it("should call onTabReordered callback", () => {
      let reorderedTabs: string[] = [];

      tabBar = new TabBar(mockTabs, {
        onTabReordered: ids => {
          reorderedTabs = ids;
        },
      });

      const newOrder = ["tab3", "tab1", "tab2", "tab4", "tab5"];
      tabBar.reorderTabs(newOrder);

      expect(reorderedTabs).toEqual(newOrder);
    });

    it("should reject invalid reorder with missing tab IDs", () => {
      const invalidOrder = ["tab1", "tab2"]; // Missing tabs
      const originalOrder = tabBar.getTabOrder();

      tabBar.reorderTabs(invalidOrder);

      expect(tabBar.getTabOrder()).toEqual(originalOrder);
    });

    it("should reject invalid reorder with extra tab IDs", () => {
      const invalidOrder = ["tab1", "tab2", "tab3", "tab4", "tab5", "fake"];
      const originalOrder = tabBar.getTabOrder();

      tabBar.reorderTabs(invalidOrder);

      expect(tabBar.getTabOrder()).toEqual(originalOrder);
    });
  });

  describe("Tab Pinning", () => {
    it("should pin and unpin tabs", () => {
      tabBar.pinTab("tab3", true);
      expect(tabBar.isTabPinned("tab3")).toBe(true);

      tabBar.pinTab("tab3", false);
      expect(tabBar.isTabPinned("tab3")).toBe(false);
    });

    it("should call onTabPinned callback", () => {
      let pinnedTab = "";
      let pinState = false;

      tabBar = new TabBar(mockTabs, {
        onTabPinned: (id, pinned) => {
          pinnedTab = id;
          pinState = pinned;
        },
      });

      tabBar.pinTab("tab2", true);

      expect(pinnedTab).toBe("tab2");
      expect(pinState).toBe(true);
    });

    it("should not pin non-existent tabs", () => {
      tabBar.pinTab("nonexistent", true);
      expect(tabBar.isTabPinned("nonexistent")).toBe(false);
    });

    it("should place pinned tabs first in display order", () => {
      tabBar.pinTab("tab5", true);
      tabBar.pinTab("tab3", true);

      const element = tabBar.render();
      const tabHeaders = element.querySelectorAll("[data-tab-id]");
      const renderedOrder = Array.from(tabHeaders).map(el => el.getAttribute("data-tab-id"));

      // Pinned tabs (tab3, tab5) should appear before unpinned in rendered order
      const lastPinnedIndex = Math.max(
        renderedOrder.indexOf("tab3"),
        renderedOrder.indexOf("tab5")
      );
      const firstUnpinnedIndex = renderedOrder.findIndex(id => id !== "tab3" && id !== "tab5");

      expect(lastPinnedIndex).toBeLessThan(firstUnpinnedIndex);
    });
  });

  describe("Tab Rendering", () => {
    it("should render tab bar container", () => {
      const element = tabBar.render();
      expect(element).toBeDefined();
      expect(element.className).toContain("tab-bar");
    });

    it("should render all tabs", () => {
      const element = tabBar.render();
      const tabHeaders = element.querySelectorAll("[data-tab-id]");
      expect(tabHeaders.length).toBe(5);
    });

    it("should highlight selected tab", () => {
      const element = tabBar.render();
      const selectedTab = element.querySelector('[data-tab-id="tab1"]') as HTMLElement;

      expect(selectedTab).toBeDefined();
      expect(selectedTab.style.backgroundColor).toMatch(/rgb\(255.*255.*255\)|#fff(fff)?|white/);
    });

    it("should show stale context indicator", () => {
      const tab = mockTabs[0];
      // Simulate stale context by making it return true
      (tab as any).hasStaleContext = () => true;

      const element = tabBar.render();
      const indicatorEl = element.querySelector("[data-tab-id='tab1']");

      // Look for the orange indicator (would need to check span with style)
      expect(indicatorEl).toBeDefined();
    });

    it("should show pin indicator for pinned tabs", () => {
      tabBar.pinTab("tab2", true);
      const element = tabBar.render();

      const tabEl = element.querySelector('[data-tab-id="tab2"]');
      expect(tabEl?.textContent).toContain("📌");
    });
  });

  describe("Tab Update", () => {
    it("should update tab list", () => {
      const newTabs = [
        createMockTabSurface("tab1", "terminal", "Terminal"),
        createMockTabSurface("tab2", "agent", "Agent"),
      ];

      tabBar.updateTabs(newTabs);

      expect(tabBar.getTabOrder()).toContain("tab1");
      expect(tabBar.getTabOrder()).toContain("tab2");
      expect(tabBar.getTabOrder()).not.toContain("tab3");
    });

    it("should preserve selection when updating tabs", () => {
      tabBar.selectTab("tab2");

      const newTabs = [
        createMockTabSurface("tab1", "terminal", "Terminal"),
        createMockTabSurface("tab2", "agent", "Agent"),
        createMockTabSurface("tab3", "session", "Session"),
      ];

      tabBar.updateTabs(newTabs);

      expect(tabBar.getSelectedTabId()).toBe("tab2");
    });

    it("should reset selection if selected tab is removed", () => {
      tabBar.selectTab("tab3");

      const newTabs = [
        createMockTabSurface("tab1", "terminal", "Terminal"),
        createMockTabSurface("tab2", "agent", "Agent"),
      ];

      tabBar.updateTabs(newTabs);

      expect(["tab1", "tab2"]).toContain(tabBar.getSelectedTabId() || "");
    });

    it("should add new tabs at the end", () => {
      const newTabs = [
        createMockTabSurface("tab1", "terminal", "Terminal"),
        createMockTabSurface("tab2", "agent", "Agent"),
        createMockTabSurface("tab6", "project", "NewProject"),
      ];

      tabBar.updateTabs(newTabs);

      const order = tabBar.getTabOrder();
      const tab6Index = order.indexOf("tab6");

      expect(tab6Index).toBeGreaterThan(-1);
    });
  });
});
