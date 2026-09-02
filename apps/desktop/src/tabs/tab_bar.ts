import type { TabSurface } from "./tab_surface";

export interface TabBarConfig {
  onTabSelected?: (tabId: string) => void;
  onTabReordered?: (tabIds: string[]) => void;
  onTabPinned?: (tabId: string, pinned: boolean) => void;
}

/**
 * TabBar manages the display and interaction of tab headers.
 *
 * Features:
 * - Renders tab headers with labels and selection highlighting.
 * - Handles tab selection via click or keyboard (Enter/Space).
 * - Supports tab reordering via drag-and-drop or keyboard.
 * - Supports tab pinning with visual indicators.
 * - Displays stale-context warning indicators.
 * - Full keyboard accessibility (Tab/Shift-Tab, Arrow keys).
 */
export class TabBar {
  private tabs: TabSurface[] = [];
  private selectedTabId: string | null = null;
  private pinnedTabIds = new Set<string>();
  private tabOrder: string[] = [];
  private focusedTabIndex: number = 0;
  private draggedTabId: string | null = null;
  private config: Required<TabBarConfig>;
  private container: HTMLElement | null = null;

  constructor(tabs: TabSurface[], config: TabBarConfig = {}) {
    this.tabs = tabs;
    this.tabOrder = tabs.map(t => t.getTabId());
    this.selectedTabId = tabs.length > 0 ? tabs[0].getTabId() : null;
    this.config = {
      onTabSelected: config.onTabSelected ?? (() => {}),
      onTabReordered: config.onTabReordered ?? (() => {}),
      onTabPinned: config.onTabPinned ?? (() => {}),
    };
  }

  /**
   * Get the currently selected tab ID.
   */
  getSelectedTabId(): string | null {
    return this.selectedTabId;
  }

  /**
   * Select a tab by ID.
   */
  selectTab(tabId: string): void {
    const tab = this.tabs.find(t => t.getTabId() === tabId);
    if (!tab) return;

    // Deactivate previous tab
    if (this.selectedTabId) {
      const prevTab = this.tabs.find(t => t.getTabId() === this.selectedTabId);
      if (prevTab) {
        prevTab.onDeactivate();
      }
    }

    // Activate new tab
    this.selectedTabId = tabId;
    tab.onActivate();
    this.config.onTabSelected(tabId);
  }

  /**
   * Get the tab order.
   */
  getTabOrder(): string[] {
    return [...this.tabOrder];
  }

  /**
   * Reorder tabs.
   */
  reorderTabs(newOrder: string[]): void {
    // Validate that all tab IDs are present
    const tabIds = new Set(this.tabs.map(t => t.getTabId()));
    const newOrderSet = new Set(newOrder);

    if (newOrder.length !== this.tabs.length || ![...tabIds].every(id => newOrderSet.has(id))) {
      console.error("Invalid tab order: missing or extra tab IDs");
      return;
    }

    this.tabOrder = newOrder;
    this.config.onTabReordered(newOrder);
  }

  /**
   * Pin a tab so it appears first and cannot be reordered past other pinned tabs.
   */
  pinTab(tabId: string, pinned: boolean = true): void {
    const tab = this.tabs.find(t => t.getTabId() === tabId);
    if (!tab) return;

    if (pinned) {
      this.pinnedTabIds.add(tabId);
    } else {
      this.pinnedTabIds.delete(tabId);
    }

    this.config.onTabPinned(tabId, pinned);
  }

  /**
   * Check if a tab is pinned.
   */
  isTabPinned(tabId: string): boolean {
    return this.pinnedTabIds.has(tabId);
  }

  /**
   * Render the tab bar.
   */
  render(): HTMLElement {
    const container = document.createElement("div");
    container.className = "tab-bar";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.borderBottom = "1px solid #e0e0e0";
    container.style.backgroundColor = "#f5f5f5";
    container.style.padding = "0 8px";
    container.style.gap = "0";

    this.container = container;

    // Get ordered tabs (pinned first)
    const orderedTabs = this.getOrderedTabs();

    // Render each tab header
    orderedTabs.forEach((tab, index) => {
      const tabEl = this.renderTabHeader(tab, index);
      container.appendChild(tabEl);
    });

    return container;
  }

  /**
   * Get tabs in display order (pinned first).
   */
  private getOrderedTabs(): TabSurface[] {
    const tabMap = new Map(this.tabs.map(t => [t.getTabId(), t]));
    const pinned = this.tabOrder.filter(id => this.pinnedTabIds.has(id));
    const unpinned = this.tabOrder.filter(id => !this.pinnedTabIds.has(id));

    return [...pinned, ...unpinned]
      .map(id => tabMap.get(id))
      .filter((t): t is TabSurface => t !== undefined);
  }

  /**
   * Render a single tab header.
   */
  private renderTabHeader(tab: TabSurface, index: number): HTMLElement {
    const isSelected = tab.getTabId() === this.selectedTabId;
    const hasStaleContext = tab.hasStaleContext();

    const headerEl = document.createElement("button");
    headerEl.className = "tab-header";
    headerEl.setAttribute("data-tab-id", tab.getTabId());
    headerEl.setAttribute("tabindex", this.focusedTabIndex === index ? "0" : "-1");
    headerEl.style.flex = "1";
    headerEl.style.padding = "12px 16px";
    headerEl.style.border = "none";
    headerEl.style.backgroundColor = isSelected ? "#ffffff" : "#f5f5f5";
    headerEl.style.borderBottom = isSelected ? "2px solid #1976d2" : "2px solid transparent";
    headerEl.style.cursor = "pointer";
    headerEl.style.fontSize = "14px";
    headerEl.style.fontWeight = isSelected ? "600" : "400";
    headerEl.style.color = isSelected ? "#1976d2" : "#666";
    headerEl.style.transition = "all 0.2s ease";
    headerEl.style.display = "flex";
    headerEl.style.alignItems = "center";
    headerEl.style.gap = "8px";
    headerEl.style.whiteSpace = "nowrap";

    // Label
    const labelEl = document.createElement("span");
    labelEl.textContent = tab.getLabel();
    headerEl.appendChild(labelEl);

    // Stale context indicator
    if (hasStaleContext) {
      const indicatorEl = document.createElement("span");
      indicatorEl.style.width = "8px";
      indicatorEl.style.height = "8px";
      indicatorEl.style.borderRadius = "50%";
      indicatorEl.style.backgroundColor = "#ff9800";
      indicatorEl.style.display = "inline-block";
      indicatorEl.title = "This tab may be showing stale data";
      headerEl.appendChild(indicatorEl);
    }

    // Pin indicator
    if (this.pinnedTabIds.has(tab.getTabId())) {
      const pinEl = document.createElement("span");
      pinEl.textContent = "📌";
      pinEl.style.fontSize = "10px";
      pinEl.title = "Tab is pinned";
      headerEl.appendChild(pinEl);
    }

    // Event listeners
    headerEl.addEventListener("click", () => {
      this.selectTab(tab.getTabId());
    });

    headerEl.addEventListener("keydown", e => {
      this.handleTabKeydown(e, tab.getTabId());
    });

    headerEl.addEventListener("dragstart", () => {
      this.draggedTabId = tab.getTabId();
    });

    headerEl.addEventListener("dragover", e => {
      e.preventDefault();
      if (this.draggedTabId && this.draggedTabId !== tab.getTabId()) {
        this.handleTabDrop(tab.getTabId());
      }
    });

    headerEl.addEventListener("drop", e => {
      e.preventDefault();
      if (this.draggedTabId && this.draggedTabId !== tab.getTabId()) {
        this.handleTabDrop(tab.getTabId());
      }
    });

    headerEl.addEventListener("dragend", () => {
      this.draggedTabId = null;
    });

    headerEl.draggable = true;

    return headerEl;
  }

  /**
   * Handle keyboard navigation in tab headers.
   */
  private handleTabKeydown(event: KeyboardEvent, tabId: string): void {
    const orderedTabs = this.getOrderedTabs();
    const currentIndex = orderedTabs.findIndex(t => t.getTabId() === tabId);

    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault();
        this.selectTab(tabId);
        break;

      case "ArrowRight":
        event.preventDefault();
        if (currentIndex < orderedTabs.length - 1) {
          const nextTab = orderedTabs[currentIndex + 1];
          this.focusedTabIndex = currentIndex + 1;
          this.focusTab(nextTab.getTabId());
        }
        break;

      case "ArrowLeft":
        event.preventDefault();
        if (currentIndex > 0) {
          const prevTab = orderedTabs[currentIndex - 1];
          this.focusedTabIndex = currentIndex - 1;
          this.focusTab(prevTab.getTabId());
        }
        break;

      case "Tab":
        // Allow natural Tab behavior to move focus out of tab bar
        break;

      default:
        break;
    }
  }

  /**
   * Focus a tab by ID.
   */
  private focusTab(tabId: string): void {
    if (!this.container) return;

    const tabEl = this.container.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement;

    if (tabEl) {
      tabEl.setAttribute("tabindex", "0");
      tabEl.focus();

      // Update other tabs' tabindex
      const allTabs = this.container.querySelectorAll("[data-tab-id]");
      allTabs.forEach(el => {
        if (el !== tabEl) {
          (el as HTMLElement).setAttribute("tabindex", "-1");
        }
      });
    }
  }

  /**
   * Handle tab drop/reorder.
   */
  private handleTabDrop(targetTabId: string): void {
    if (!this.draggedTabId || this.draggedTabId === targetTabId) {
      return;
    }

    const draggedIndex = this.tabOrder.indexOf(this.draggedTabId);
    const targetIndex = this.tabOrder.indexOf(targetTabId);

    if (draggedIndex === -1 || targetIndex === -1) {
      return;
    }

    // Reorder: remove dragged tab and insert before target
    const newOrder = [...this.tabOrder];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, this.draggedTabId);

    this.reorderTabs(newOrder);
  }

  /**
   * Update the tab list.
   */
  updateTabs(tabs: TabSurface[]): void {
    this.tabs = tabs;
    // Preserve order where possible, add new tabs at the end
    const existingIds = new Set(this.tabOrder);
    const newIds = tabs.map(t => t.getTabId());
    const addedIds = newIds.filter(id => !existingIds.has(id));

    this.tabOrder = [...this.tabOrder.filter(id => newIds.includes(id)), ...addedIds];

    // Remove selected if no longer exists
    if (this.selectedTabId && !newIds.includes(this.selectedTabId)) {
      this.selectTab(newIds[0] || "");
    }
  }
}
