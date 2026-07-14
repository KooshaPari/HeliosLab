import { HotSwapToggle } from "../../../src/settings/hotswap_toggle";

describe("HotSwapToggle", () => {
  let container: HTMLDivElement;
  let toggle: HotSwapToggle;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (toggle) {
      toggle.unmount();
    }
    document.body.removeChild(container);
  });

  it("should render toggle in enabled state", () => {
    const onToggle = vi.fn();
    toggle = new HotSwapToggle({
      isEnabled: true,
      onToggle,
    });

    toggle.mount(container);

    const label = container.querySelector(".hotswap-label");
    expect(label?.textContent).toContain("Prefer hot-swap when available");
  });

  it("should render toggle in disabled state", () => {
    const onToggle = vi.fn();
    toggle = new HotSwapToggle({
      isEnabled: false,
      onToggle,
    });

    toggle.mount(container);

    const label = container.querySelector(".hotswap-label");
    expect(label?.textContent).toContain("Always use restart-with-restore");
  });

  it("should toggle when clicked", () => {
    const onToggle = vi.fn();
    toggle = new HotSwapToggle({
      isEnabled: true,
      onToggle,
    });

    toggle.mount(container);

    const toggleSwitch = container.querySelector(".hotswap-switch") as HTMLElement;
    toggleSwitch?.click();

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("should show correct tooltip for enabled state", () => {
    const onToggle = vi.fn();
    toggle = new HotSwapToggle({
      isEnabled: true,
      onToggle,
    });

    toggle.mount(container);

    const tooltip = container.querySelector(".tooltip-icon");
    expect(tooltip?.getAttribute("title")).toContain("3s");
  });

  it("should show correct tooltip for disabled state", () => {
    const onToggle = vi.fn();
    toggle = new HotSwapToggle({
      isEnabled: false,
      onToggle,
    });

    toggle.mount(container);

    const tooltip = container.querySelector(".tooltip-icon");
    expect(tooltip?.getAttribute("title")).toContain("8s");
  });

  it("should update when update() is called", () => {
    const onToggle = vi.fn();
    toggle = new HotSwapToggle({
      isEnabled: true,
      onToggle,
    });

    toggle.mount(container);

    let label = container.querySelector(".hotswap-label");
    expect(label?.textContent).toContain("Prefer hot-swap");

    toggle.update({ isEnabled: false });

    label = container.querySelector(".hotswap-label");
    expect(label?.textContent).toContain("Always use restart");
  });

  it("should handle keyboard activation", () => {
    const onToggle = vi.fn();
    toggle = new HotSwapToggle({
      isEnabled: true,
      onToggle,
    });

    toggle.mount(container);

    const toggleSwitch = container.querySelector(".hotswap-switch") as HTMLElement;
    const spaceEvent = new KeyboardEvent("keydown", { key: " " });
    toggleSwitch?.dispatchEvent(spaceEvent);

    expect(onToggle).toHaveBeenCalled();
  });

  it("should have proper accessibility attributes", () => {
    const onToggle = vi.fn();
    toggle = new HotSwapToggle({
      isEnabled: true,
      onToggle,
    });

    toggle.mount(container);

    const toggleSwitch = container.querySelector(".hotswap-switch");
    expect(toggleSwitch?.getAttribute("role")).toBe("switch");
    expect(toggleSwitch?.getAttribute("aria-checked")).toBe("true");
  });
});
