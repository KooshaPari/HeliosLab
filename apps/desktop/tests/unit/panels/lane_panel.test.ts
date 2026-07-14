import { LanePanel } from "../../../src/panels/lane_panel";
import type { Lane } from "../../../src/panels/lane_panel";

// Traces to: FR-LST-001, FR-LST-002, FR-LST-003
describe("LanePanel", () => {
  let container: HTMLDivElement;
  let panel: LanePanel;

  const mockProps = {
    lanes: [] as Lane[],
    activeWorkspaceId: "ws-1",
    onLaneSelect: vi.fn(),
    onLaneCreate: vi.fn(),
    onLaneDelete: vi.fn(),
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (panel) {
      panel.unmount();
    }
    document.body.removeChild(container);
  });

  it("should render empty state when no lanes exist", () => {
    panel = new LanePanel(mockProps);
    panel.mount(container);

    const emptyState = container.querySelector(".lane-panel-empty");
    expect(emptyState).toBeTruthy();
    expect(emptyState?.textContent).toContain("No lanes in this workspace");
  });

  it("should render loading state when isLoading is true", () => {
    panel = new LanePanel({ ...mockProps, isLoading: true });
    panel.mount(container);

    const loadingState = container.querySelector(".lane-panel-loading");
    expect(loadingState).toBeTruthy();
    expect(loadingState?.textContent).toContain("Loading lanes...");
  });

  it("should render all lanes in filtered workspace", () => {
    // Traces to: FR-LST-001 (display all lanes in active workspace)
    const lanes: Lane[] = [
      { id: "lane-1", name: "Lane 1", state: "idle", workspaceId: "ws-1" },
      { id: "lane-2", name: "Lane 2", state: "running", workspaceId: "ws-1" },
      { id: "lane-3", name: "Lane 3", state: "idle", workspaceId: "ws-2" },
    ];

    panel = new LanePanel({ ...mockProps, lanes });
    panel.mount(container);

    const items = container.querySelectorAll("[data-lane-item]");
    expect(items.length).toBe(2); // Only ws-1 lanes
    expect(items[0].getAttribute("data-lane-item")).toBe("lane-1");
    expect(items[1].getAttribute("data-lane-item")).toBe("lane-2");
  });

  it("should render 50 lanes with proper structure", () => {
    const lanes: Lane[] = Array.from({ length: 50 }, (_, i) => ({
      id: `lane-${i}`,
      name: `Lane ${i}`,
      state: "idle",
      workspaceId: "ws-1",
    }));

    panel = new LanePanel({ ...mockProps, lanes });
    const start = performance.now();
    panel.mount(container);
    const end = performance.now();

    const items = container.querySelectorAll("[data-lane-item]");
    expect(items.length).toBe(50);
    expect(end - start).toBeLessThan(300); // Performance assertion
  });

  it("should call onLaneSelect when lane is clicked", () => {
    const lanes: Lane[] = [{ id: "lane-1", name: "Lane 1", state: "idle", workspaceId: "ws-1" }];
    const onLaneSelect = vi.fn();

    panel = new LanePanel({ ...mockProps, lanes, onLaneSelect });
    panel.mount(container);

    const item = container.querySelector('[data-lane-item="lane-1"]') as HTMLElement;
    item?.click();

    expect(onLaneSelect).toHaveBeenCalledWith("lane-1");
  });

  it("should call onLaneCreate when create button is clicked", () => {
    const onLaneCreate = vi.fn();

    panel = new LanePanel({ ...mockProps, onLaneCreate });
    panel.mount(container);

    const createBtn = container.querySelector('[data-action="create-lane"]') as HTMLElement;
    createBtn?.click();

    expect(onLaneCreate).toHaveBeenCalled();
  });

  it("should navigate lanes with arrow keys", () => {
    const lanes: Lane[] = [
      { id: "lane-1", name: "Lane 1", state: "idle", workspaceId: "ws-1" },
      { id: "lane-2", name: "Lane 2", state: "running", workspaceId: "ws-1" },
      { id: "lane-3", name: "Lane 3", state: "error", workspaceId: "ws-1" },
    ];

    panel = new LanePanel({ ...mockProps, lanes });
    panel.mount(container);

    // Arrow down
    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    container.dispatchEvent(event);

    let selectedItems = container.querySelectorAll(".lane-list-item.selected");
    expect(selectedItems.length).toBeGreaterThan(0);
  });

  it("should update lanes when update() is called", () => {
    const initialLanes: Lane[] = [
      { id: "lane-1", name: "Lane 1", state: "idle", workspaceId: "ws-1" },
    ];
    panel = new LanePanel({ ...mockProps, lanes: initialLanes });
    panel.mount(container);

    let items = container.querySelectorAll("[data-lane-item]");
    expect(items.length).toBe(1);

    const newLanes: Lane[] = [
      { id: "lane-1", name: "Lane 1", state: "idle", workspaceId: "ws-1" },
      { id: "lane-2", name: "Lane 2", state: "running", workspaceId: "ws-1" },
    ];
    panel.update({ lanes: newLanes });

    items = container.querySelectorAll("[data-lane-item]");
    expect(items.length).toBe(2);
  });

  it("should display active lane indicator", () => {
    const lanes: Lane[] = [
      { id: "lane-1", name: "Lane 1", state: "idle", workspaceId: "ws-1" },
      {
        id: "lane-2",
        name: "Lane 2",
        state: "running",
        workspaceId: "ws-1",
        isActive: true,
      },
    ];

    panel = new LanePanel({ ...mockProps, lanes, activeLaneId: "lane-2" });
    panel.mount(container);

    const activeItem = container.querySelector('[data-lane-item="lane-2"].active');
    expect(activeItem).toBeTruthy();

    const indicator = activeItem?.querySelector(".lane-item-active-indicator");
    expect(indicator).toBeTruthy();
  });

  it("should handle Home key to jump to first lane", () => {
    const lanes: Lane[] = [
      { id: "lane-1", name: "Lane 1", state: "idle", workspaceId: "ws-1" },
      { id: "lane-2", name: "Lane 2", state: "running", workspaceId: "ws-1" },
    ];

    panel = new LanePanel({ ...mockProps, lanes });
    panel.mount(container);

    const event = new KeyboardEvent("keydown", { key: "Home" });
    container.dispatchEvent(event);

    // First lane should be selected
    const firstItem = container.querySelector('[data-lane-item="lane-1"]');
    expect(firstItem?.classList.contains("selected")).toBeTruthy();
  });

  it("should handle End key to jump to last lane", () => {
    const lanes: Lane[] = [
      { id: "lane-1", name: "Lane 1", state: "idle", workspaceId: "ws-1" },
      { id: "lane-2", name: "Lane 2", state: "running", workspaceId: "ws-1" },
    ];

    panel = new LanePanel({ ...mockProps, lanes });
    panel.mount(container);

    const event = new KeyboardEvent("keydown", { key: "End" });
    container.dispatchEvent(event);

    // Last lane should be selected
    const lastItem = container.querySelector('[data-lane-item="lane-2"]');
    expect(lastItem?.classList.contains("selected")).toBeTruthy();
  });

  it("should call onLaneDelete when Delete key is pressed", () => {
    const lanes: Lane[] = [{ id: "lane-1", name: "Lane 1", state: "idle", workspaceId: "ws-1" }];
    const onLaneDelete = vi.fn();

    panel = new LanePanel({ ...mockProps, lanes, onLaneDelete });
    panel.mount(container);

    // First select the lane
    const item = container.querySelector('[data-lane-item="lane-1"]') as HTMLElement;
    item?.click();

    // Then press Delete
    const event = new KeyboardEvent("keydown", { key: "Delete" });
    container.dispatchEvent(event);

    expect(onLaneDelete).toHaveBeenCalledWith("lane-1");
  });
});
