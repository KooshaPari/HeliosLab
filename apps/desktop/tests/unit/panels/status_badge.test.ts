import {
  StatusBadge,
  getStatusBadgeContent,
  DEFAULT_COLOR_SCHEME,
} from "../../../src/panels/status_badge";

describe("StatusBadge", () => {
  let container: HTMLDivElement;
  let badge: StatusBadge;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (badge) {
      badge.unmount();
    }
    document.body.removeChild(container);
  });

  it("should render badge for idle state", () => {
    badge = new StatusBadge({ state: "idle" });
    badge.mount(container);

    const badgeElement = container.querySelector('.status-badge[data-state="idle"]');
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Idle");
  });

  it("should render badge for running state", () => {
    badge = new StatusBadge({ state: "running" });
    badge.mount(container);

    const badgeElement = container.querySelector('.status-badge[data-state="running"]');
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Running");
  });

  it("should render badge for blocked state", () => {
    badge = new StatusBadge({ state: "blocked" });
    badge.mount(container);

    const badgeElement = container.querySelector('.status-badge[data-state="blocked"]');
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Blocked");
  });

  it("should render badge for error state", () => {
    badge = new StatusBadge({ state: "error" });
    badge.mount(container);

    const badgeElement = container.querySelector('.status-badge[data-state="error"]');
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Error");
  });

  it("should render badge for shared state", () => {
    badge = new StatusBadge({ state: "shared" });
    badge.mount(container);

    const badgeElement = container.querySelector('.status-badge[data-state="shared"]');
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Shared");
  });

  it("should render badge for provisioning state", () => {
    badge = new StatusBadge({ state: "provisioning" });
    badge.mount(container);

    const badgeElement = container.querySelector('.status-badge[data-state="provisioning"]');
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Provisioning...");
  });

  it("should render badge for cleaning state", () => {
    badge = new StatusBadge({ state: "cleaning" });
    badge.mount(container);

    const badgeElement = container.querySelector('.status-badge[data-state="cleaning"]');
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Cleaning...");
  });

  it("should render badge for closed state", () => {
    badge = new StatusBadge({ state: "closed" });
    badge.mount(container);

    const badgeElement = container.querySelector('.status-badge[data-state="closed"]');
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Closed");
  });

  it("should render badge for orphaned state", () => {
    badge = new StatusBadge({ state: "orphaned" });
    badge.mount(container);

    const badgeElement = container.querySelector('.status-badge[data-state="orphaned"]');
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Orphaned");
  });

  it("should render fallback for unknown state", () => {
    badge = new StatusBadge({ state: "unknown-state" });
    badge.mount(container);

    const badgeElement = container.querySelector(".status-badge");
    expect(badgeElement).toBeTruthy();
    expect(badgeElement?.getAttribute("aria-label")).toBe("Unknown state");
  });

  it("should apply correct colors from scheme", () => {
    badge = new StatusBadge({ state: "running" });
    badge.mount(container);

    const badgeElement = container.querySelector(
      '.status-badge[data-state="running"]'
    ) as HTMLElement;
    const scheme = DEFAULT_COLOR_SCHEME.running;

    expect(badgeElement?.style.color).toBe(scheme.color);
    expect(badgeElement?.style.backgroundColor).toBe(scheme.bgColor);
  });

  it("should update badge state when update() is called", () => {
    badge = new StatusBadge({ state: "idle" });
    badge.mount(container);

    let badgeElement = container.querySelector('.status-badge[data-state="idle"]');
    expect(badgeElement).toBeTruthy();

    badge.update({ state: "running" });

    badgeElement = container.querySelector('.status-badge[data-state="running"]');
    expect(badgeElement).toBeTruthy();
  });

  it("should include ARIA labels for accessibility", () => {
    const states = [
      "idle",
      "running",
      "blocked",
      "error",
      "shared",
      "provisioning",
      "cleaning",
      "closed",
      "orphaned",
    ];

    states.forEach(state => {
      badge = new StatusBadge({ state });
      badge.mount(container);

      const badgeElement = container.querySelector(".status-badge");
      expect(badgeElement?.getAttribute("aria-label")).toBeTruthy();
      expect(badgeElement?.getAttribute("aria-label")).not.toBe("");

      badge.unmount();
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    });
  });

  it("should have status role attribute", () => {
    badge = new StatusBadge({ state: "idle" });
    badge.mount(container);

    const badgeElement = container.querySelector(".status-badge");
    expect(badgeElement?.getAttribute("role")).toBe("status");
  });

  it("getStatusBadgeContent should return correct content", () => {
    const content = getStatusBadgeContent("running");

    expect(content.label).toBe("Running");
    expect(content.icon).toBe("●");
    expect(content.color).toBe(DEFAULT_COLOR_SCHEME.running.color);
    expect(content.bgColor).toBe(DEFAULT_COLOR_SCHEME.running.bgColor);
  });

  it("should render tooltip element", () => {
    badge = new StatusBadge({ state: "running" });
    badge.mount(container);

    const tooltip = container.querySelector(".badge-tooltip");
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe("Running");
  });

  it("should render icon element", () => {
    badge = new StatusBadge({ state: "running" });
    badge.mount(container);

    const icon = container.querySelector(".badge-icon");
    expect(icon).toBeTruthy();
    expect(icon?.textContent).toBe("●");
  });
});
