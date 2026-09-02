/**
 * Hot-Swap Toggle Component
 * Allows users to control switch behavior preference
 */

export interface HotSwapToggleProps {
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export class HotSwapToggle {
  private props: HotSwapToggleProps;
  private container: HTMLElement | null = null;

  constructor(props: HotSwapToggleProps) {
    this.props = props;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  unmount(): void {
    this.container = null;
  }

  update(props: Partial<HotSwapToggleProps>): void {
    Object.assign(this.props, props);
    this.render();
  }

  private render(): void {
    if (!this.container) return;

    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }

    const toggle = this.createToggleElement();
    this.container.appendChild(toggle);
    this.attachEventListeners();
  }

  private createToggleElement(): HTMLElement {
    const container = document.createElement("div");
    container.className = "hotswap-toggle-container";
    container.style.padding = "12px";
    container.style.backgroundColor = "#f9fafb";
    container.style.borderRadius = "6px";
    container.style.marginTop = "16px";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "space-between";
    container.style.gap = "12px";

    // Left side: label
    const labelContainer = document.createElement("div");
    labelContainer.style.flex = "1";

    const label = document.createElement("label");
    label.htmlFor = "hotswap-toggle";
    label.className = "hotswap-label";
    label.style.fontWeight = "500";
    label.style.color = "#374151";
    label.style.fontSize = "14px";
    label.style.cursor = "pointer";
    label.textContent = this.props.isEnabled
      ? "Prefer hot-swap when available"
      : "Always use restart-with-restore";

    labelContainer.appendChild(label);

    // Tooltip icon
    const tooltipIcon = document.createElement("span");
    tooltipIcon.className = "tooltip-icon";
    tooltipIcon.textContent = "?";
    tooltipIcon.style.display = "inline-block";
    tooltipIcon.style.width = "18px";
    tooltipIcon.style.height = "18px";
    tooltipIcon.style.backgroundColor = "#e5e7eb";
    tooltipIcon.style.color = "#6b7280";
    tooltipIcon.style.borderRadius = "50%";
    tooltipIcon.style.textAlign = "center";
    tooltipIcon.style.lineHeight = "18px";
    tooltipIcon.style.fontSize = "12px";
    tooltipIcon.style.fontWeight = "bold";
    tooltipIcon.style.marginLeft = "6px";
    tooltipIcon.style.cursor = "help";
    tooltipIcon.setAttribute("title", this.getTooltipText());

    labelContainer.appendChild(tooltipIcon);
    container.appendChild(labelContainer);

    // Right side: toggle switch
    const toggleSwitch = document.createElement("div");
    toggleSwitch.className = "hotswap-switch";
    toggleSwitch.style.position = "relative";
    toggleSwitch.style.width = "44px";
    toggleSwitch.style.height = "24px";
    toggleSwitch.style.backgroundColor = this.props.isEnabled ? "#10b981" : "#d1d5db";
    toggleSwitch.style.borderRadius = "12px";
    toggleSwitch.style.cursor = "pointer";
    toggleSwitch.style.transition = "background-color 200ms ease-in-out";

    // Toggle knob
    const knob = document.createElement("div");
    knob.className = "hotswap-knob";
    knob.style.position = "absolute";
    knob.style.top = "2px";
    knob.style.left = this.props.isEnabled ? "22px" : "2px";
    knob.style.width = "20px";
    knob.style.height = "20px";
    knob.style.backgroundColor = "white";
    knob.style.borderRadius = "50%";
    knob.style.transition = "left 200ms ease-in-out";
    knob.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.1)";

    toggleSwitch.appendChild(knob);

    // Hidden checkbox for accessibility
    const checkbox = document.createElement("input");
    checkbox.id = "hotswap-toggle";
    checkbox.type = "checkbox";
    checkbox.checked = this.props.isEnabled;
    checkbox.style.display = "none";

    container.appendChild(toggleSwitch);
    container.appendChild(checkbox);

    return container;
  }

  private getTooltipText(): string {
    if (this.props.isEnabled) {
      return "Faster switch (~3s) when supported by both renderers.";
    } else {
      return "Slower but more reliable switch (~8s) via full restart.";
    }
  }

  private attachEventListeners(): void {
    if (!this.container) return;

    const toggleSwitch = this.container.querySelector(".hotswap-switch") as HTMLElement;
    const checkbox = this.container.querySelector("#hotswap-toggle") as HTMLInputElement;

    if (toggleSwitch) {
      toggleSwitch.addEventListener("click", () => {
        const newState = !this.props.isEnabled;
        this.props.onToggle(newState);
      });

      toggleSwitch.addEventListener("keydown", e => {
        const event = e as KeyboardEvent;
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          const newState = !this.props.isEnabled;
          this.props.onToggle(newState);
        }
      });

      toggleSwitch.setAttribute("role", "switch");
      toggleSwitch.setAttribute("aria-checked", String(this.props.isEnabled));
      toggleSwitch.tabIndex = 0;
    }

    if (checkbox) {
      checkbox.addEventListener("change", () => {
        this.props.onToggle(checkbox.checked);
      });
    }
  }
}

export function createHotSwapToggle(props: HotSwapToggleProps): HotSwapToggle {
  return new HotSwapToggle(props);
}
