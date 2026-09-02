import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { SwitchConfirmation } from "../../../src/settings/switch_confirmation";

describe("SwitchConfirmation", () => {
  let container: HTMLDivElement;
  let dialog: SwitchConfirmation;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (dialog) {
      dialog.unmount();
    }
    document.body.removeChild(container);
  });

  it("should mount to container", () => {
    const onConfirm = mock();
    const onCancel = mock();

    dialog = new SwitchConfirmation({
      targetRendererName: "Rio",
      supportsHotSwap: true,
      onConfirm: async () => onConfirm(),
      onCancel,
    });

    dialog.mount(container);

    expect(container).toBeTruthy();
  });

  it("should show hot-swap message when supported", async () => {
    const onConfirm = mock();
    const onCancel = mock();

    dialog = new SwitchConfirmation({
      targetRendererName: "Rio",
      supportsHotSwap: true,
      onConfirm: async () => onConfirm(),
      onCancel,
    });

    dialog.mount(container);
    await dialog.open();

    await new Promise(resolve => setTimeout(resolve, 300));

    const content = container.textContent || "";
    expect(content).toContain("hot-swap");
    expect(content).toContain("3 seconds");
  });

  it("should show restart message when hot-swap not supported", async () => {
    const onConfirm = mock();
    const onCancel = mock();

    dialog = new SwitchConfirmation({
      targetRendererName: "Rio",
      supportsHotSwap: false,
      onConfirm: async () => onConfirm(),
      onCancel,
    });

    dialog.mount(container);
    await dialog.open();

    await new Promise(resolve => setTimeout(resolve, 300));

    const content = container.textContent || "";
    expect(content).toContain("restart");
    expect(content).toContain("8 seconds");
  });

  it("should call onConfirm when confirm button clicked", async () => {
    const onConfirm = mock();
    const onCancel = mock();

    dialog = new SwitchConfirmation({
      targetRendererName: "Rio",
      supportsHotSwap: true,
      onConfirm: async () => onConfirm(),
      onCancel,
    });

    dialog.mount(container);
    await dialog.open();

    await new Promise(resolve => setTimeout(resolve, 300));

    const confirmBtn = container.querySelector(".switch-confirm") as HTMLButtonElement;
    confirmBtn?.click();

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(onConfirm).toHaveBeenCalled();
  });

  it("should call onCancel when cancel button clicked", async () => {
    const onConfirm = mock();
    const onCancel = mock();

    dialog = new SwitchConfirmation({
      targetRendererName: "Rio",
      supportsHotSwap: true,
      onConfirm: async () => onConfirm(),
      onCancel,
    });

    dialog.mount(container);
    await dialog.open();

    await new Promise(resolve => setTimeout(resolve, 300));

    const cancelBtn = container.querySelector(".switch-cancel") as HTMLButtonElement;
    cancelBtn?.click();

    expect(onCancel).toHaveBeenCalled();
  });

  it("should close dialog when Escape is pressed", async () => {
    const onConfirm = mock();
    const onCancel = mock();

    dialog = new SwitchConfirmation({
      targetRendererName: "Rio",
      supportsHotSwap: true,
      onConfirm: async () => onConfirm(),
      onCancel,
    });

    dialog.mount(container);
    await dialog.open();

    await new Promise(resolve => setTimeout(resolve, 300));

    const dialogElement = container.querySelector(".switch-confirmation-dialog");
    const escapeEvent = new KeyboardEvent("keydown", { key: "Escape" });
    dialogElement?.dispatchEvent(escapeEvent);

    expect(onCancel).toHaveBeenCalled();
  });

  it("should have proper accessibility attributes", async () => {
    const onConfirm = mock();
    const onCancel = mock();

    dialog = new SwitchConfirmation({
      targetRendererName: "Rio",
      supportsHotSwap: true,
      onConfirm: async () => onConfirm(),
      onCancel,
    });

    dialog.mount(container);
    await dialog.open();

    await new Promise(resolve => setTimeout(resolve, 300));

    const dialogElement = container.querySelector(".switch-confirmation-dialog");
    expect(dialogElement?.getAttribute("role")).toBe("alertdialog");
    expect(dialogElement?.getAttribute("aria-modal")).toBe("true");
  });
});
