import { SettingsLock } from "../../../src/settings/settings_lock";

describe("SettingsLock", () => {
  let container: HTMLDivElement;
  let lock: SettingsLock;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    // Add some interactive elements
    const button = document.createElement("button");
    button.textContent = "Test Button";
    container.appendChild(button);

    const input = document.createElement("input");
    input.type = "checkbox";
    container.appendChild(input);

    const switchDiv = document.createElement("div");
    switchDiv.setAttribute("role", "switch");
    container.appendChild(switchDiv);
  });

  afterEach(() => {
    if (lock) {
      lock.destroy();
    }
    document.body.removeChild(container);
  });

  it("should lock settings", () => {
    lock = new SettingsLock();
    lock.lock(container);

    expect(lock.isSettingsLocked()).toBe(true);

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("should unlock settings", () => {
    lock = new SettingsLock();
    lock.lock(container);
    lock.unlock(container);

    expect(lock.isSettingsLocked()).toBe(false);

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it("should apply visual lock effect", () => {
    lock = new SettingsLock();
    lock.lock(container);

    const initialOpacity = container.style.opacity;
    expect(Number(initialOpacity)).toBeLessThan(1);
    expect(container.style.pointerEvents).toBe("none");
  });

  it("should auto-unlock after timeout", async () => {
    const onAutoUnlocked = vi.fn();
    lock = new SettingsLock({
      autoUnlockTimeoutMs: 100,
      onAutoUnlocked,
    });

    lock.lock(container);
    expect(lock.isSettingsLocked()).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 150));

    expect(lock.isSettingsLocked()).toBe(false);
    expect(onAutoUnlocked).toHaveBeenCalled();
  });

  it("should set aria-disabled on switch elements", () => {
    lock = new SettingsLock();
    lock.lock(container);

    const switchDiv = container.querySelector('[role="switch"]');
    expect(switchDiv?.getAttribute("aria-disabled")).toBe("true");
  });

  it("should not lock twice", () => {
    lock = new SettingsLock();
    lock.lock(container);
    lock.lock(container); // Second lock should be no-op

    expect(lock.isSettingsLocked()).toBe(true);

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
