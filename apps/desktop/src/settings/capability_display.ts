/**
 * Capability Display Component
 * Shows detailed renderer capabilities in an expandable panel
 */

export interface Capability {
  version: string;
  supportsHotSwap: boolean;
  features: string[];
  constraints?: string;
}

export interface CapabilityDisplayProps {
  capability: Capability | null;
  isLoading?: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: (expanded: boolean) => void;
}

export class CapabilityDisplay {
  private props: CapabilityDisplayProps;
  private container: HTMLElement | null = null;
  private isExpanded: boolean = false;

  constructor(props: CapabilityDisplayProps) {
    this.props = props;
    this.isExpanded = props.isExpanded || false;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  unmount(): void {
    this.container = null;
  }

  update(props: Partial<CapabilityDisplayProps>): void {
    Object.assign(this.props, props);
    if (props.isExpanded !== undefined) {
      this.isExpanded = props.isExpanded;
    }
    this.render();
  }

  private render(): void {
    if (!this.container) return;

    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    const panel = this.createCapabilityPanel();
    this.container.appendChild(panel);
    this.attachEventListeners();
  }

  private createCapabilityPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "capability-display";
    panel.style.marginTop = "12px";
    panel.style.padding = "12px";
    panel.style.backgroundColor = "#f3f4f6";
    panel.style.borderRadius = "6px";

    // Header / Toggle
    const header = document.createElement("div");
    header.className = "capability-header";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.cursor = "pointer";
    header.style.userSelect = "none";

    const titleContainer = document.createElement("div");
    titleContainer.style.display = "flex";
    titleContainer.style.alignItems = "center";
    titleContainer.style.gap = "8px";

    const title = document.createElement("span");
    title.className = "capability-title";
    title.textContent = "Capabilities";
    title.style.fontWeight = "500";
    title.style.color = "#374151";
    title.style.fontSize = "13px";
    titleContainer.appendChild(title);

    const icon = document.createElement("span");
    icon.className = "capability-toggle-icon";
    icon.textContent = this.isExpanded ? "▼" : "▶";
    icon.style.fontSize = "12px";
    icon.style.color = "#6b7280";
    icon.style.transition = "transform 200ms ease-in-out";
    titleContainer.appendChild(icon);

    header.appendChild(titleContainer);

    // Expanded content toggle button
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "capability-toggle-btn";
    toggleBtn.setAttribute("aria-expanded", String(this.isExpanded));
    toggleBtn.style.background = "none";
    toggleBtn.style.border = "none";
    toggleBtn.style.cursor = "pointer";
    toggleBtn.style.padding = "0";
    toggleBtn.textContent = this.isExpanded ? "Collapse" : "Expand";
    toggleBtn.style.fontSize = "12px";
    toggleBtn.style.color = "#3b82f6";
    header.appendChild(toggleBtn);

    panel.appendChild(header);

    // Content
    if (this.props.isLoading) {
      if (this.isExpanded) {
        const loading = document.createElement("div");
        loading.className = "capability-loading";
        loading.textContent = "Loading capabilities...";
        loading.style.marginTop = "8px";
        loading.style.fontSize = "13px";
        loading.style.color = "#9ca3af";
        panel.appendChild(loading);
      }
    } else if (!this.props.capability) {
      if (this.isExpanded) {
        const error = document.createElement("div");
        error.className = "capability-error";
        error.textContent = "Capability information unavailable.";
        error.style.marginTop = "8px";
        error.style.fontSize = "13px";
        error.style.color = "#ef4444";
        panel.appendChild(error);
      }
    } else {
      if (this.isExpanded) {
        const content = this.createCapabilityContent(this.props.capability);
        panel.appendChild(content);
      }
    }

    return panel;
  }

  private createCapabilityContent(capability: Capability): HTMLElement {
    const content = document.createElement("div");
    content.className = "capability-content";
    content.style.marginTop = "12px";
    content.style.animation = "fadeIn 200ms ease-in-out";

    // Version
    const versionSection = document.createElement("div");
    versionSection.style.marginBottom = "12px";

    const versionLabel = document.createElement("span");
    versionLabel.textContent = "Version: ";
    versionLabel.style.fontSize = "13px";
    versionLabel.style.color = "#6b7280";
    versionLabel.style.fontWeight = "500";

    const versionValue = document.createElement("span");
    versionValue.textContent = capability.version;
    versionValue.style.fontSize = "13px";
    versionValue.style.color = "#1f2937";
    versionValue.style.fontFamily = "monospace";

    versionSection.appendChild(versionLabel);
    versionSection.appendChild(versionValue);
    content.appendChild(versionSection);

    // Hot-swap support
    const hotSwapSection = document.createElement("div");
    hotSwapSection.style.marginBottom = "12px";

    const hotSwapLabel = document.createElement("span");
    hotSwapLabel.textContent = "Hot-Swap: ";
    hotSwapLabel.style.fontSize = "13px";
    hotSwapLabel.style.color = "#6b7280";
    hotSwapLabel.style.fontWeight = "500";

    const hotSwapValue = document.createElement("span");
    hotSwapValue.style.fontSize = "13px";
    hotSwapValue.style.fontWeight = "500";

    if (capability.supportsHotSwap) {
      hotSwapValue.textContent = "Supported - seamless transition (~3s)";
      hotSwapValue.style.color = "#16a34a";
      hotSwapValue.style.backgroundColor = "#dcfce7";
      hotSwapValue.style.padding = "2px 6px";
      hotSwapValue.style.borderRadius = "3px";
    } else {
      hotSwapValue.textContent = "Not supported - restart with restore (~8s)";
      hotSwapValue.style.color = "#ea580c";
      hotSwapValue.style.backgroundColor = "#fed7aa";
      hotSwapValue.style.padding = "2px 6px";
      hotSwapValue.style.borderRadius = "3px";
    }

    hotSwapSection.appendChild(hotSwapLabel);
    hotSwapSection.appendChild(hotSwapValue);
    content.appendChild(hotSwapSection);

    // Features list
    if (capability.features && capability.features.length > 0) {
      const featuresSection = document.createElement("div");
      featuresSection.style.marginBottom = "12px";

      const featuresLabel = document.createElement("div");
      featuresLabel.textContent = "Features:";
      featuresLabel.style.fontSize = "13px";
      featuresLabel.style.color = "#6b7280";
      featuresLabel.style.fontWeight = "500";
      featuresLabel.style.marginBottom = "6px";
      featuresSection.appendChild(featuresLabel);

      const featuresList = document.createElement("ul");
      featuresList.style.margin = "0";
      featuresList.style.padding = "0 0 0 16px";

      capability.features.forEach(feature => {
        const item = document.createElement("li");
        item.textContent = feature;
        item.style.fontSize = "13px";
        item.style.color = "#374151";
        item.style.marginBottom = "4px";
        featuresList.appendChild(item);
      });

      featuresSection.appendChild(featuresList);
      content.appendChild(featuresSection);
    }

    // Constraints
    if (capability.constraints) {
      const constraintsSection = document.createElement("div");

      const constraintsLabel = document.createElement("span");
      constraintsLabel.textContent = "Constraints: ";
      constraintsLabel.style.fontSize = "13px";
      constraintsLabel.style.color = "#6b7280";
      constraintsLabel.style.fontWeight = "500";

      const constraintsValue = document.createElement("span");
      constraintsValue.textContent = capability.constraints;
      constraintsValue.style.fontSize = "13px";
      constraintsValue.style.color = "#1f2937";

      constraintsSection.appendChild(constraintsLabel);
      constraintsSection.appendChild(constraintsValue);
      content.appendChild(constraintsSection);
    }

    return content;
  }

  private attachEventListeners(): void {
    if (!this.container) return;

    const header = this.container.querySelector(".capability-header") as HTMLElement;
    const toggleBtn = this.container.querySelector(".capability-toggle-btn") as HTMLElement;

    if (header) {
      header.addEventListener("click", () => {
        this.toggleExpanded();
      });
    }

    if (toggleBtn) {
      toggleBtn.addEventListener("click", e => {
        e.stopPropagation();
        this.toggleExpanded();
      });

      toggleBtn.addEventListener("keydown", e => {
        const event = e as KeyboardEvent;
        if (event.key === "Enter") {
          event.preventDefault();
          this.toggleExpanded();
        }
      });
    }
  }

  private toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
    if (this.props.onToggleExpanded) {
      this.props.onToggleExpanded(this.isExpanded);
    }
    this.render();
  }
}

export function createCapabilityDisplay(props: CapabilityDisplayProps): CapabilityDisplay {
  return new CapabilityDisplay(props);
}
