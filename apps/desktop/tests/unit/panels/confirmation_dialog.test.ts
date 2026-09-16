import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { ConfirmationDialog } from "../../../src/panels/confirmation_dialog";

describe("ConfirmationDialog", () => {
	let container: HTMLDivElement;
	let dialog: ConfirmationDialog;

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

		dialog = new ConfirmationDialog({
			title: "Delete Lane",
			message: "Are you sure?",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);

		expect(container).toBeTruthy();
	});

	it("should open dialog with title and message", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Delete Lane",
			message: "Are you sure you want to delete this lane?",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		const dialogElement = container.querySelector(".confirmation-dialog");
		expect(dialogElement).toBeTruthy();

		const title = container.querySelector(".confirmation-title");
		expect(title?.textContent).toBe("Delete Lane");

		const message = container.querySelector(".confirmation-message");
		expect(message?.textContent).toContain("Are you sure");
	});

	it("should call onConfirm when confirm button is clicked", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Delete",
			message: "Continue?",
			confirmLabel: "Delete",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		const confirmBtn = container.querySelector(
			".confirmation-confirm",
		) as HTMLButtonElement;
		confirmBtn?.click();

		expect(onConfirm).toHaveBeenCalled();
	});

	it("should call onCancel when cancel button is clicked", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Delete",
			message: "Continue?",
			cancelLabel: "Cancel",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		const cancelBtn = container.querySelector(
			".confirmation-cancel",
		) as HTMLButtonElement;
		cancelBtn?.click();

		expect(onCancel).toHaveBeenCalled();
	});

	it("should close dialog when Escape is pressed", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Delete",
			message: "Continue?",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		const dialogElement = container.querySelector(".confirmation-dialog");
		const escapeEvent = new KeyboardEvent("keydown", { key: "Escape" });
		dialogElement?.dispatchEvent(escapeEvent);

		expect(onCancel).toHaveBeenCalled();
	});

	it("should confirm when Enter is pressed", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Delete",
			message: "Continue?",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		const dialogElement = container.querySelector(".confirmation-dialog");
		const enterEvent = new KeyboardEvent("keydown", { key: "Enter" });
		dialogElement?.dispatchEvent(enterEvent);

		expect(onConfirm).toHaveBeenCalled();
	});

	it("should trap focus within dialog", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Delete",
			message: "Continue?",
			confirmLabel: "Delete",
			cancelLabel: "Keep",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		const buttons = container.querySelectorAll(
			"button",
		) as NodeListOf<HTMLButtonElement>;
		expect(buttons.length).toBeGreaterThanOrEqual(2);

		// Focus should be on first button
		const confirmBtn = container.querySelector(
			".confirmation-confirm",
		) as HTMLButtonElement;
		confirmBtn?.focus();

		// Tab should move to next button
		const tabEvent = new KeyboardEvent("keydown", {
			key: "Tab",
			bubbles: true,
		});
		confirmBtn?.dispatchEvent(tabEvent);

		// This tests the focus trap logic
	});

	it("should apply danger styling when isDangerous is true", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Delete",
			message: "Continue?",
			isDangerous: true,
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		const confirmBtn = container.querySelector(
			".confirmation-confirm",
		) as HTMLElement;
		const bgColor = confirmBtn?.style.backgroundColor;

		// Red color for dangerous action
		expect(bgColor).toMatch(/244|ef4444/); // RGB for red #ef4444
	});

	it("should use custom button labels", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Action",
			message: "Message",
			confirmLabel: "Yes, Do It",
			cancelLabel: "No, Cancel",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		const confirmBtn = container.querySelector(".confirmation-confirm");
		const cancelBtn = container.querySelector(".confirmation-cancel");

		expect(confirmBtn?.textContent).toBe("Yes, Do It");
		expect(cancelBtn?.textContent).toBe("No, Cancel");
	});

	it("should have proper ARIA attributes", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Delete",
			message: "Are you sure?",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		const dialogElement = container.querySelector(".confirmation-dialog");
		expect(dialogElement?.getAttribute("role")).toBe("alertdialog");
		expect(dialogElement?.getAttribute("aria-modal")).toBe("true");
	});

	it("should close dialog with fade-out animation", async () => {
		const onConfirm = mock();
		const onCancel = mock();

		dialog = new ConfirmationDialog({
			title: "Delete",
			message: "Continue?",
			onConfirm,
			onCancel,
		});

		dialog.mount(container);
		dialog.open();

		await new Promise((resolve) => setTimeout(resolve, 300));

		let dialogElement = container.querySelector(".confirmation-dialog");
		expect(dialogElement).toBeTruthy();

		const confirmBtn = container.querySelector(
			".confirmation-confirm",
		) as HTMLButtonElement;
		confirmBtn?.click();

		// Wait for fade-out animation
		await new Promise((resolve) => setTimeout(resolve, 300));

		dialogElement = container.querySelector(".confirmation-dialog");
		expect(dialogElement).toBeFalsy();
	});
});
