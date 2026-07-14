import { KeyboardNav } from "../../../src/panels/keyboard_nav";
import type { KeyboardNavCallbacks } from "../../../src/panels/keyboard_nav";

describe("KeyboardNav", () => {
  let container: HTMLDivElement;
  let nav: KeyboardNav;

  const createMockCallbacks = (): KeyboardNavCallbacks => ({
    onNavigateUp: vi.fn(),
    onNavigateDown: vi.fn(),
    onNavigateHome: vi.fn(),
    onNavigateEnd: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn().mockResolvedValue(true),
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    // Create mock list items
    for (let i = 0; i < 5; i++) {
      const item = document.createElement("div");
      item.setAttribute("role", "option");
      item.textContent = `Lane ${i}`;
      container.appendChild(item);
    }
  });

  afterEach(() => {
    if (nav) {
      nav.unmount();
    }
    document.body.removeChild(container);
  });

  it("should initialize with correct item count", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);

    expect(nav.getCurrentIndex()).toBe(0);
  });

  it("should navigate down with ArrowDown key", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);

    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    container.dispatchEvent(event);

    expect(callbacks.onNavigateDown).toHaveBeenCalled();
    expect(nav.getCurrentIndex()).toBe(1);
  });

  it("should navigate up with ArrowUp key", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);
    nav.setCurrentIndex(2);

    const event = new KeyboardEvent("keydown", { key: "ArrowUp" });
    container.dispatchEvent(event);

    expect(callbacks.onNavigateUp).toHaveBeenCalled();
    expect(nav.getCurrentIndex()).toBe(1);
  });

  it("should navigate to Home with Home key", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);
    nav.setCurrentIndex(3);

    const event = new KeyboardEvent("keydown", { key: "Home" });
    container.dispatchEvent(event);

    expect(callbacks.onNavigateHome).toHaveBeenCalled();
    expect(nav.getCurrentIndex()).toBe(0);
  });

  it("should navigate to End with End key", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);

    const event = new KeyboardEvent("keydown", { key: "End" });
    container.dispatchEvent(event);

    expect(callbacks.onNavigateEnd).toHaveBeenCalled();
    expect(nav.getCurrentIndex()).toBe(4);
  });

  it("should call onSelect with Enter key", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    container.dispatchEvent(event);

    expect(callbacks.onSelect).toHaveBeenCalled();
  });

  it("should call onDelete with Delete key", async () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);

    const event = new KeyboardEvent("keydown", { key: "Delete" });
    container.dispatchEvent(event);

    // Give async handler time to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(callbacks.onDelete).toHaveBeenCalled();
  });

  it("should call onDelete with Backspace key", async () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);

    const event = new KeyboardEvent("keydown", { key: "Backspace" });
    container.dispatchEvent(event);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(callbacks.onDelete).toHaveBeenCalled();
  });

  it("should not navigate up beyond first item by default", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks, { enableWrap: false });
    nav.mount(container);
    nav.setItemCount(5);
    nav.setCurrentIndex(0);

    const event = new KeyboardEvent("keydown", { key: "ArrowUp" });
    container.dispatchEvent(event);

    expect(nav.getCurrentIndex()).toBe(0);
  });

  it("should not navigate down beyond last item by default", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks, { enableWrap: false });
    nav.mount(container);
    nav.setItemCount(5);
    nav.setCurrentIndex(4);

    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    container.dispatchEvent(event);

    expect(nav.getCurrentIndex()).toBe(4);
  });

  it("should wrap around when enableWrap is true", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks, { enableWrap: true });
    nav.mount(container);
    nav.setItemCount(5);
    nav.setCurrentIndex(4);

    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    container.dispatchEvent(event);

    expect(nav.getCurrentIndex()).toBe(0);
  });

  it("should clamp index when item count decreases", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);
    nav.setCurrentIndex(4);

    nav.setItemCount(2);

    expect(nav.getCurrentIndex()).toBe(1);
  });

  it("should maintain index within bounds", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);

    nav.setCurrentIndex(10);

    expect(nav.getCurrentIndex()).toBeLessThan(5);
  });

  it("should prevent default event behavior for navigation keys", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);

    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    container.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("should ignore non-navigation keys", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);

    const event = new KeyboardEvent("keydown", { key: "a" });
    container.dispatchEvent(event);

    expect(callbacks.onNavigateUp).not.toHaveBeenCalled();
    expect(callbacks.onNavigateDown).not.toHaveBeenCalled();
  });

  it("should handle multiple sequential navigations", () => {
    const callbacks = createMockCallbacks();
    nav = new KeyboardNav(callbacks);
    nav.mount(container);
    nav.setItemCount(5);

    // Down twice
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

    expect(nav.getCurrentIndex()).toBe(2);

    // Up once
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));

    expect(nav.getCurrentIndex()).toBe(1);
  });
});
