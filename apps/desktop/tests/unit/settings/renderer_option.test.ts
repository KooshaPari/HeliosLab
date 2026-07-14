import { RendererOption } from "../../../src/settings/renderer_option";

describe("RendererOption", () => {
  let container: HTMLDivElement;
  let option: RendererOption;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (option) {
      option.unmount();
    }
    document.body.removeChild(container);
  });

  it("should render available renderer as clickable", () => {
    const onSelect = vi.fn();
    option = new RendererOption({
      rendererId: "ghostty",
      name: "Ghostty",
      isAvailable: true,
      isActive: false,
      onSelect,
    });

    option.mount(container);

    const rendererOption = container.querySelector('[data-renderer="ghostty"]');
    expect(rendererOption).toBeTruthy();
    expect(rendererOption?.getAttribute("tabindex")).not.toBe("-1");
  });

  it("should render unavailable renderer as disabled", () => {
    const onSelect = vi.fn();
    option = new RendererOption({
      rendererId: "rio",
      name: "Rio",
      isAvailable: false,
      isActive: false,
      unavailableReason: "Feature flag disabled",
      onSelect,
    });

    option.mount(container);

    const rendererOption = container.querySelector('[data-renderer="rio"]');
    expect(rendererOption?.getAttribute("tabindex")).toBe("-1");

    const radio = rendererOption?.querySelector("input") as HTMLInputElement;
    expect(radio?.disabled).toBeTruthy();
  });

  it("should show active badge when isActive is true", () => {
    const onSelect = vi.fn();
    option = new RendererOption({
      rendererId: "ghostty",
      name: "Ghostty",
      isAvailable: true,
      isActive: true,
      onSelect,
    });

    option.mount(container);

    const activeBadge = container.querySelector(".active-badge");
    expect(activeBadge?.textContent).toBe("Active");
  });

  it("should call onSelect when clicked", () => {
    const onSelect = vi.fn();
    option = new RendererOption({
      rendererId: "rio",
      name: "Rio",
      isAvailable: true,
      isActive: false,
      onSelect,
    });

    option.mount(container);

    const rendererOption = container.querySelector('[data-renderer="rio"]') as HTMLElement;
    rendererOption?.click();

    expect(onSelect).toHaveBeenCalledWith("rio");
  });

  it("should not call onSelect when already active", () => {
    const onSelect = vi.fn();
    option = new RendererOption({
      rendererId: "ghostty",
      name: "Ghostty",
      isAvailable: true,
      isActive: true,
      onSelect,
    });

    option.mount(container);

    const rendererOption = container.querySelector('[data-renderer="ghostty"]') as HTMLElement;
    rendererOption?.click();

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("should call onSelect when Enter is pressed", () => {
    const onSelect = vi.fn();
    option = new RendererOption({
      rendererId: "rio",
      name: "Rio",
      isAvailable: true,
      isActive: false,
      onSelect,
    });

    option.mount(container);

    const rendererOption = container.querySelector('[data-renderer="rio"]') as HTMLElement;
    const enterEvent = new KeyboardEvent("keydown", { key: "Enter" });
    rendererOption?.dispatchEvent(enterEvent);

    expect(onSelect).toHaveBeenCalledWith("rio");
  });

  it("should update when update() is called", () => {
    const onSelect = vi.fn();
    option = new RendererOption({
      rendererId: "ghostty",
      name: "Ghostty",
      isAvailable: true,
      isActive: false,
      onSelect,
    });

    option.mount(container);

    let activeBadge = container.querySelector(".active-badge");
    expect(activeBadge).toBeFalsy();

    option.update({ isActive: true });

    activeBadge = container.querySelector(".active-badge");
    expect(activeBadge?.textContent).toBe("Active");
  });

  it("should display unavailable reason in title", () => {
    const onSelect = vi.fn();
    const reason = "Feature flag disabled for this build";
    option = new RendererOption({
      rendererId: "rio",
      name: "Rio",
      isAvailable: false,
      isActive: false,
      unavailableReason: reason,
      onSelect,
    });

    option.mount(container);

    const rendererOption = container.querySelector('[data-renderer="rio"]');
    expect(rendererOption?.getAttribute("title")).toBe(reason);
  });

  it("should have proper ARIA attributes", () => {
    const onSelect = vi.fn();
    option = new RendererOption({
      rendererId: "ghostty",
      name: "Ghostty",
      isAvailable: true,
      isActive: false,
      onSelect,
    });

    option.mount(container);

    const rendererOption = container.querySelector('[data-renderer="ghostty"]');
    expect(rendererOption?.getAttribute("role")).toBe("button");
  });

  it("should show unavailable badge for unavailable renderers", () => {
    const onSelect = vi.fn();
    option = new RendererOption({
      rendererId: "rio",
      name: "Rio",
      isAvailable: false,
      isActive: false,
      onSelect,
    });

    option.mount(container);

    const unavailableBadge = container.querySelector(".unavailable-badge");
    expect(unavailableBadge?.textContent).toBe("Not Available");
  });
});
