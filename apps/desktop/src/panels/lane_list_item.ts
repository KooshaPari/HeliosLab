/**
 * Lane List Item Component
 * Renders a single lane entry with status badge, label, and action triggers
 */

import { getStatusBadgeContent } from "./status_badge";

export interface LaneListItemProps {
  laneId: string;
  laneName: string;
  state: string;
  isActive?: boolean;
  isSelected?: boolean;
  isOrphaned?: boolean;
  sessionCount?: number;
  onSelect: (laneId: string) => void;
  onContextMenu: (laneId: string, event: MouseEvent) => void;
}

export class LaneListItem {
  private props: LaneListItemProps;
  private container: HTMLElement | null = null;

  constructor(props: LaneListItemProps) {
    this.props = props;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
    this.attachEventListeners();
  }

  unmount(): void {
    this.detachEventListeners();
    this.container = null;
  }

  update(props: Partial<LaneListItemProps>): void {
    Object.assign(this.props, props);
    this.render();
  }

  private render(): void {
    if (!this.container) return;

    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    const item = this.createItemElement();
    this.container.appendChild(item);
  }

  private createItemElement(): HTMLElement {
    const item = document.createElement("div");
    item.className = `lane-list-item ${this.props.isActive ? "active" : ""} ${this.props.isSelected ? "selected" : ""}`;
    item.setAttribute("data-lane-item", this.props.laneId);
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(this.props.isSelected || false));
    item.setAttribute("tabindex", "0");

    // Badge container
    const badgeContainer = document.createElement("div");
    badgeContainer.className = "lane-item-badge";
    badgeContainer.setAttribute("data-state", this.props.state);

    // Orphan icon
    if (this.props.isOrphaned) {
      const orphanIcon = document.createElement("span");
      orphanIcon.className = "orphan-icon";
      orphanIcon.setAttribute("title", "Orphaned");
      orphanIcon.setAttribute("aria-label", "Lane is orphaned");
      orphanIcon.textContent = "⚠";
      badgeContainer.appendChild(orphanIcon);
    }

    // Status badge
    const badgeContent = getStatusBadgeContent(this.props.state);
    const badge = document.createElement("span");
    badge.className = "badge-icon";
    badge.setAttribute("data-state", this.props.state);
    badge.setAttribute("aria-label", badgeContent.label);
    badge.textContent = badgeContent.icon;
    badgeContainer.appendChild(badge);

    item.appendChild(badgeContainer);

    // Info container
    const infoContainer = document.createElement("div");
    infoContainer.className = "lane-item-info";

    // Lane name
    const nameSpan = document.createElement("span");
    nameSpan.className = "lane-item-name";
    nameSpan.setAttribute("title", this.props.laneName);
    nameSpan.textContent = this.truncateName(this.props.laneName, 30);
    infoContainer.appendChild(nameSpan);

    // Session count
    if (this.props.sessionCount && this.props.sessionCount > 0) {
      const countSpan = document.createElement("span");
      countSpan.className = "lane-item-count";
      countSpan.textContent = String(this.props.sessionCount);
      infoContainer.appendChild(countSpan);
    }

    item.appendChild(infoContainer);

    // Active indicator
    if (this.props.isActive) {
      const indicator = document.createElement("div");
      indicator.className = "lane-item-active-indicator";
      indicator.setAttribute("aria-label", "Currently active lane");
      item.appendChild(indicator);
    }

    return item;
  }

  private truncateName(name: string, maxLength: number): string {
    if (name.length <= maxLength) {
      return name;
    }
    return name.substring(0, maxLength - 3) + "...";
  }

  private attachEventListeners(): void {
    if (!this.container) return;

    const item = this.container.querySelector(".lane-list-item");
    if (!item) return;

    item.addEventListener("click", () => {
      this.props.onSelect(this.props.laneId);
    });

    item.addEventListener("contextmenu", e => {
      e.preventDefault();
      this.props.onContextMenu(this.props.laneId, e as MouseEvent);
    });

    item.addEventListener("keydown", e => {
      const event = e as KeyboardEvent;
      if (event.key === "Enter") {
        event.preventDefault();
        this.props.onSelect(this.props.laneId);
      }
    });
  }

  private detachEventListeners(): void {
    if (!this.container) return;

    const item = this.container.querySelector(".lane-list-item");
    if (!item) return;

    // Event listeners are automatically removed when element is removed
  }
}

export function createLaneListItem(props: LaneListItemProps): LaneListItem {
  return new LaneListItem(props);
}
