import { CapabilityDisplay } from "../../../src/settings/capability_display";
import type { Capability } from "../../../src/settings/capability_display";

describe("CapabilityDisplay", () => {
  let container: HTMLDivElement;
  let display: CapabilityDisplay;

  const mockCapability: Capability = {
    version: "0.20.0",
    supportsHotSwap: true,
    features: ["GPU acceleration", "Ligatures", "Sixel support"],
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (display) {
      display.unmount();
    }
    document.body.removeChild(container);
  });

  it("should render collapsed by default", () => {
    const onToggle = vi.fn();
    display = new CapabilityDisplay({
      capability: mockCapability,
      onToggleExpanded: onToggle,
    });

    display.mount(container);

    const content = container.querySelector(".capability-content");
    expect(content).toBeFalsy();
  });

  it("should expand when toggle clicked", async () => {
    const onToggle = vi.fn();
    display = new CapabilityDisplay({
      capability: mockCapability,
      onToggleExpanded: onToggle,
    });

    display.mount(container);

    const header = container.querySelector(".capability-header") as HTMLElement;
    header?.click();

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("should display version when expanded", () => {
    display = new CapabilityDisplay({
      capability: mockCapability,
      isExpanded: true,
    });

    display.mount(container);

    const content = container.textContent;
    expect(content).toContain("0.20.0");
  });

  it("should show hot-swap support when expanded", () => {
    display = new CapabilityDisplay({
      capability: mockCapability,
      isExpanded: true,
    });

    display.mount(container);

    const content = container.textContent;
    expect(content).toContain("Supported");
    expect(content).toContain("3s");
  });

  it("should show hot-swap unsupported message", () => {
    const noHotSwapCapability: Capability = {
      ...mockCapability,
      supportsHotSwap: false,
    };

    display = new CapabilityDisplay({
      capability: noHotSwapCapability,
      isExpanded: true,
    });

    display.mount(container);

    const content = container.textContent;
    expect(content).toContain("Not supported");
    expect(content).toContain("restart");
    expect(content).toContain("8s");
  });

  it("should display feature list when expanded", () => {
    display = new CapabilityDisplay({
      capability: mockCapability,
      isExpanded: true,
    });

    display.mount(container);

    const content = container.textContent;
    expect(content).toContain("GPU acceleration");
    expect(content).toContain("Ligatures");
    expect(content).toContain("Sixel support");
  });

  it("should display loading state when isLoading is true", () => {
    display = new CapabilityDisplay({
      capability: null,
      isLoading: true,
      isExpanded: true,
    });

    display.mount(container);

    const loading = container.querySelector(".capability-loading");
    expect(loading?.textContent).toContain("Loading capabilities");
  });

  it("should display error when capability is null", () => {
    display = new CapabilityDisplay({
      capability: null,
      isExpanded: true,
    });

    display.mount(container);

    const error = container.querySelector(".capability-error");
    expect(error?.textContent).toContain("unavailable");
  });
});
