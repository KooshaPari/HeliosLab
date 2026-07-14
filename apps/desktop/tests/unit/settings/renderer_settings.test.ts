import { RendererSettings } from "../../../src/settings/renderer_settings";
import type { Renderer } from "../../../src/settings/renderer_settings";

// Traces to: FR-ENG-001, FR-ENG-002
describe("RendererSettings", () => {
  let container: HTMLDivElement;
  let settings: RendererSettings;

  const mockRenderers: Renderer[] = [
    { id: "ghostty", name: "Ghostty", isAvailable: true, isActive: true },
    { id: "rio", name: "Rio", isAvailable: true, isActive: false },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (settings) {
      settings.unmount();
    }
    document.body.removeChild(container);
  });

  it("should render settings section with header", () => {
    // Traces to: FR-ENG-001 (settings panel section)
    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers: mockRenderers,
      onRendererSelect,
    });

    settings.mount(container);

    const header = container.querySelector(".renderer-settings-header");
    expect(header?.textContent).toBe("Renderer Engine");
  });

  it("should render settings section with description", () => {
    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers: mockRenderers,
      onRendererSelect,
    });

    settings.mount(container);

    const description = container.querySelector(".renderer-settings-description");
    expect(description?.textContent).toContain("Choose your terminal renderer");
  });

  it("should render all available renderers", () => {
    // Traces to: FR-ENG-002 (display both ghostty and rio with availability)
    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers: mockRenderers,
      onRendererSelect,
    });

    settings.mount(container);

    const options = container.querySelectorAll(".renderer-option");
    expect(options.length).toBe(2);
  });

  it("should display active renderer indicator", () => {
    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers: mockRenderers,
      onRendererSelect,
    });

    settings.mount(container);

    const activeOption = container.querySelector('[data-renderer="ghostty"]');
    expect(activeOption?.classList.contains("active")).toBeTruthy();

    const activeBadge = activeOption?.textContent;
    expect(activeBadge).toContain("Active");
  });

  it("should display unavailable renderer as disabled", () => {
    const renderers: Renderer[] = [
      { id: "ghostty", name: "Ghostty", isAvailable: true, isActive: true },
      { id: "rio", name: "Rio", isAvailable: false, isActive: false },
    ];

    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers,
      onRendererSelect,
    });

    settings.mount(container);

    const unavailableOption = container.querySelector('[data-renderer="rio"]');
    expect(unavailableOption?.classList.contains("unavailable")).toBeTruthy();

    const radio = unavailableOption?.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(radio?.disabled).toBeTruthy();
  });

  it("should call onRendererSelect when renderer is clicked", () => {
    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers: mockRenderers,
      onRendererSelect,
    });

    settings.mount(container);

    const rioOption = container.querySelector('[data-renderer="rio"]') as HTMLElement;
    rioOption?.click();

    expect(onRendererSelect).toHaveBeenCalledWith("rio");
  });

  it("should display loading state", () => {
    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers: [],
      onRendererSelect,
      isLoading: true,
    });

    settings.mount(container);

    const loadingDiv = container.querySelector(".renderer-settings-loading");
    expect(loadingDiv?.textContent).toContain("Loading renderer options");
  });

  it("should display error state", () => {
    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers: [],
      onRendererSelect,
      error: "Failed to load renderers",
    });

    settings.mount(container);

    const errorDiv = container.querySelector(".renderer-settings-error");
    expect(errorDiv?.textContent).toContain("Failed to load renderers");
  });

  it("should update renderers when update() is called", () => {
    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers: [mockRenderers[0]],
      onRendererSelect,
    });

    settings.mount(container);

    let options = container.querySelectorAll(".renderer-option");
    expect(options.length).toBe(1);

    settings.update({ renderers: mockRenderers });

    options = container.querySelectorAll(".renderer-option");
    expect(options.length).toBe(2);
  });

  it("should update active indicator when active renderer changes", () => {
    const onRendererSelect = vi.fn();
    const renderers = [...mockRenderers];
    settings = new RendererSettings({
      renderers,
      onRendererSelect,
    });

    settings.mount(container);

    let activeOption = container.querySelector(".renderer-option.active");
    expect(activeOption?.getAttribute("data-renderer")).toBe("ghostty");

    const updatedRenderers = [
      { ...renderers[0], isActive: false },
      { ...renderers[1], isActive: true },
    ];

    settings.update({ renderers: updatedRenderers });

    activeOption = container.querySelector(".renderer-option.active");
    expect(activeOption?.getAttribute("data-renderer")).toBe("rio");
  });

  it("should render radio buttons for each renderer", () => {
    const onRendererSelect = vi.fn();
    settings = new RendererSettings({
      renderers: mockRenderers,
      onRendererSelect,
    });

    settings.mount(container);

    const radios = container.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(2);

    const ghosttyOption = container.querySelector('[data-renderer="ghostty"]');
    const ghosttyRadio = ghosttyOption?.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(ghosttyRadio?.checked).toBeTruthy();
  });
});
