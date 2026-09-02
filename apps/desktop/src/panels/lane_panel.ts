/**
 * Lane Panel Component
 * Renders a left-rail panel displaying all lanes in the active workspace
 * with status badges, scrollable list, and keyboard navigation.
 */

export interface Lane {
  id: string;
  name: string;
  state: string;
  workspaceId: string;
  sessionCount?: number;
  isOrphaned?: boolean;
  isActive?: boolean;
}

export interface LanePanelProps {
  lanes: Lane[];
  activeWorkspaceId: string;
  activeLaneId?: string;
  onLaneSelect: (laneId: string) => void;
  onLaneCreate: () => void;
  onLaneDelete: (laneId: string) => void;
  isLoading?: boolean;
}

export class LanePanel {
  private lanes: Lane[] = [];
  private activeWorkspaceId: string = "";
  private activeLaneId?: string;
  private selectedLaneId?: string;
  private props: LanePanelProps;
  private container: HTMLElement | null = null;
  private scrollContainer: HTMLElement | null = null;
  private keyboardListeners: Map<string, (e: KeyboardEvent) => void> = new Map();

  constructor(props: LanePanelProps) {
    this.props = props;
    this.lanes = props.lanes;
    this.activeWorkspaceId = props.activeWorkspaceId;
    this.activeLaneId = props.activeLaneId;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
    this.attachEventListeners();
  }

  unmount(): void {
    this.detachEventListeners();
    this.container = null;
    this.scrollContainer = null;
  }

  update(props: Partial<LanePanelProps>): void {
    Object.assign(this.props, props);
    if (props.lanes) {
      this.lanes = props.lanes;
    }
    if (props.activeLaneId) {
      this.activeLaneId = props.activeLaneId;
    }
    if (props.activeWorkspaceId) {
      this.activeWorkspaceId = props.activeWorkspaceId;
    }
    this.render();
  }

  private render(): void {
    if (!this.container) return;

    this.container.innerHTML = "";
    const panel = this.createPanelElement();
    this.container.appendChild(panel);

    this.scrollContainer = this.container.querySelector('[data-panel="lane-scroll"]');

    // Set up event handlers for list items
    const items = this.container.querySelectorAll("[data-lane-item]");
    items.forEach(item => {
      const laneId = item.getAttribute("data-lane-item");
      if (!laneId) return;

      item.addEventListener("click", () => this.handleLaneSelect(laneId));
      item.addEventListener("contextmenu", e => this.handleLaneContextMenu(e, laneId));
    });
  }

  private createPanelElement(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "lane-panel";
    panel.setAttribute("data-panel", "lane-container");

    // Header
    const header = document.createElement("div");
    header.className = "lane-panel-header";

    const title = document.createElement("h2");
    title.className = "lane-panel-title";
    title.textContent = "Lanes";

    const createBtn = document.createElement("button");
    createBtn.className = "lane-panel-create-btn";
    createBtn.setAttribute("data-action", "create-lane");
    createBtn.setAttribute("aria-label", "Create new lane");
    createBtn.textContent = "+";

    header.appendChild(title);
    header.appendChild(createBtn);
    panel.appendChild(header);

    // Content
    const isLoading = this.props.isLoading;
    const filteredLanes = this.lanes.filter(lane => lane.workspaceId === this.activeWorkspaceId);

    if (isLoading) {
      const loading = document.createElement("div");
      loading.className = "lane-panel-loading";
      loading.textContent = "Loading lanes...";
      panel.appendChild(loading);
    } else if (filteredLanes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "lane-panel-empty";
      const p = document.createElement("p");
      p.textContent = "No lanes in this workspace. Create one to get started.";
      empty.appendChild(p);
      panel.appendChild(empty);
    } else {
      const scrollDiv = document.createElement("div");
      scrollDiv.className = "lane-panel-scroll";
      scrollDiv.setAttribute("data-panel", "lane-scroll");

      const listDiv = document.createElement("div");
      listDiv.className = "lane-list";

      filteredLanes.forEach(lane => {
        listDiv.appendChild(this.createLaneItemElement(lane));
      });

      scrollDiv.appendChild(listDiv);
      panel.appendChild(scrollDiv);
    }

    return panel;
  }

  private createLaneItemElement(lane: Lane): HTMLElement {
    const isActive = lane.id === this.activeLaneId;
    const isSelected = lane.id === this.selectedLaneId;

    const item = document.createElement("div");
    item.className = `lane-list-item ${isActive ? "active" : ""} ${isSelected ? "selected" : ""}`;
    item.setAttribute("data-lane-item", lane.id);
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(isSelected));
    item.setAttribute("tabindex", "0");

    // Badge
    const badge = document.createElement("div");
    badge.className = "lane-item-badge";
    badge.setAttribute("data-state", lane.state);
    badge.appendChild(this.createStatusBadgeElement(lane.state, lane.isOrphaned));

    // Info
    const info = document.createElement("div");
    info.className = "lane-item-info";

    const name = document.createElement("span");
    name.className = "lane-item-name";
    name.setAttribute("title", lane.name);
    name.textContent = lane.name;

    info.appendChild(name);

    if (lane.sessionCount) {
      const count = document.createElement("span");
      count.className = "lane-item-count";
      count.textContent = String(lane.sessionCount);
      info.appendChild(count);
    }

    item.appendChild(badge);
    item.appendChild(info);

    // Active indicator
    if (isActive) {
      const indicator = document.createElement("div");
      indicator.className = "lane-item-active-indicator";
      item.appendChild(indicator);
    }

    return item;
  }

  private createStatusBadgeElement(state: string, isOrphaned?: boolean): HTMLElement {
    const container = document.createElement("div");
    container.className = "status-badge-container";

    if (isOrphaned) {
      const orphanIcon = document.createElement("span");
      orphanIcon.className = "orphan-icon";
      orphanIcon.setAttribute("title", "Orphaned");
      orphanIcon.textContent = "⚠";
      container.appendChild(orphanIcon);
    }

    const badgeContent = this.getBadgeContent(state);
    const badge = document.createElement("span");
    badge.className = "badge-icon";
    badge.setAttribute("data-state", state);
    badge.setAttribute("aria-label", badgeContent.label);
    badge.textContent = badgeContent.icon;

    container.appendChild(badge);
    return container;
  }

  private getBadgeContent(state: string): { icon: string; label: string } {
    const badges: Record<string, { icon: string; label: string }> = {
      idle: { icon: "●", label: "Idle" },
      running: { icon: "●", label: "Running" },
      blocked: { icon: "●", label: "Blocked" },
      error: { icon: "●", label: "Error" },
      shared: { icon: "●", label: "Shared" },
      provisioning: { icon: "◌", label: "Provisioning..." },
      cleaning: { icon: "◌", label: "Cleaning..." },
      closed: { icon: "✕", label: "Closed" },
      orphaned: { icon: "⚠", label: "Orphaned" },
    };

    return badges[state] || { icon: "?", label: "Unknown state" };
  }

  private handleLaneSelect(laneId: string): void {
    this.selectedLaneId = laneId;
    this.props.onLaneSelect(laneId);
    this.render();
  }

  private handleLaneContextMenu(event: Event, laneId: string): void {
    const e = event as MouseEvent;
    e.preventDefault();
    this.handleLaneSelect(laneId);
  }

  private attachEventListeners(): void {
    if (!this.container) return;

    const createBtn = this.container.querySelector('[data-action="create-lane"]');
    if (createBtn) {
      createBtn.addEventListener("click", () => this.props.onLaneCreate());
    }

    const keyboardHandler = (e: KeyboardEvent) => {
      this.handleKeyboardNavigation(e);
    };
    this.keyboardListeners.set("keyboard", keyboardHandler);
    this.container.addEventListener("keydown", keyboardHandler);
  }

  private detachEventListeners(): void {
    if (!this.container) return;

    const keyboardHandler = this.keyboardListeners.get("keyboard");
    if (keyboardHandler) {
      this.container.removeEventListener("keydown", keyboardHandler);
    }
    this.keyboardListeners.clear();
  }

  private handleKeyboardNavigation(event: KeyboardEvent): void {
    const filteredLanes = this.lanes.filter(lane => lane.workspaceId === this.activeWorkspaceId);

    if (filteredLanes.length === 0) return;

    const currentIndex = filteredLanes.findIndex(lane => lane.id === this.selectedLaneId);
    let newIndex = currentIndex >= 0 ? currentIndex : 0;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        newIndex = Math.min(newIndex + 1, filteredLanes.length - 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        newIndex = Math.max(newIndex - 1, 0);
        break;
      case "Enter":
        event.preventDefault();
        if (currentIndex >= 0) {
          this.handleLaneSelect(filteredLanes[currentIndex].id);
        }
        return;
      case "Home":
        event.preventDefault();
        newIndex = 0;
        break;
      case "End":
        event.preventDefault();
        newIndex = filteredLanes.length - 1;
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        if (currentIndex >= 0) {
          this.props.onLaneDelete(filteredLanes[currentIndex].id);
        }
        return;
      default:
        return;
    }

    this.selectedLaneId = filteredLanes[newIndex].id;
    this.render();
  }
}

export function createLanePanel(props: LanePanelProps): LanePanel {
  return new LanePanel(props);
}
