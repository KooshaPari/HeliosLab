/**
 * Confirmation Dialog Component
 * Modal dialog for confirming destructive actions
 */

export interface ConfirmationDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDangerous?: boolean;
}

export class ConfirmationDialog {
  private props: ConfirmationDialogProps;
  private container: HTMLElement | null = null;
  private dialogElement: HTMLElement | null = null;
  private isOpen: boolean = false;
  private previousFocus: HTMLElement | null = null;

  constructor(props: ConfirmationDialogProps) {
    this.props = {
      confirmLabel: "Confirm",
      cancelLabel: "Cancel",
      isDangerous: false,
      ...props,
    };
  }

  mount(container: HTMLElement): void {
    this.container = container;
  }

  open(): void {
    if (this.isOpen || !this.container) return;

    // Store previous focus to restore on close
    this.previousFocus = document.activeElement as HTMLElement;

    this.isOpen = true;
    this.createAndShowDialog();
    this.attachEventListeners();
  }

  close(): void {
    if (!this.isOpen || !this.dialogElement) return;

    this.isOpen = false;
    this.detachEventListeners();

    // Fade out
    this.dialogElement.style.opacity = "0";
    setTimeout(() => {
      if (this.dialogElement?.parentElement) {
        this.dialogElement.parentElement.removeChild(this.dialogElement);
      }
      this.dialogElement = null;

      // Restore previous focus
      if (this.previousFocus && this.previousFocus !== document.body) {
        this.previousFocus.focus();
      }
    }, 200);
  }

  private createAndShowDialog(): void {
    if (!this.container) return;

    // Backdrop
    const backdrop = document.createElement("div");
    backdrop.className = "confirmation-backdrop";
    backdrop.style.position = "fixed";
    backdrop.style.top = "0";
    backdrop.style.left = "0";
    backdrop.style.right = "0";
    backdrop.style.bottom = "0";
    backdrop.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    backdrop.style.zIndex = "1000";

    // Dialog
    const dialog = document.createElement("div");
    dialog.className = "confirmation-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.style.position = "fixed";
    dialog.style.top = "50%";
    dialog.style.left = "50%";
    dialog.style.transform = "translate(-50%, -50%)";
    dialog.style.backgroundColor = "white";
    dialog.style.borderRadius = "8px";
    dialog.style.boxShadow = "0 10px 40px rgba(0, 0, 0, 0.2)";
    dialog.style.padding = "24px";
    dialog.style.maxWidth = "400px";
    dialog.style.zIndex = "1001";
    dialog.style.opacity = "0";
    dialog.style.transition = "opacity 200ms ease-in-out";

    // Title
    const title = document.createElement("h2");
    title.className = "confirmation-title";
    title.textContent = this.props.title;
    title.id = "dialog-title";
    title.style.margin = "0 0 12px 0";
    title.style.fontSize = "18px";
    title.style.fontWeight = "600";
    title.style.color = "#1f2937";
    dialog.appendChild(title);

    // Message
    const message = document.createElement("p");
    message.className = "confirmation-message";
    message.textContent = this.props.message;
    message.id = "dialog-message";
    message.style.margin = "0 0 20px 0";
    message.style.fontSize = "14px";
    message.style.color = "#4b5563";
    message.style.lineHeight = "1.5";
    dialog.appendChild(message);

    // Button container
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "confirmation-buttons";
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "12px";
    buttonContainer.style.justifyContent = "flex-end";

    // Cancel button
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "confirmation-cancel";
    cancelBtn.textContent = this.props.cancelLabel || "Cancel";
    cancelBtn.style.padding = "8px 16px";
    cancelBtn.style.border = "1px solid #d1d5db";
    cancelBtn.style.borderRadius = "4px";
    cancelBtn.style.backgroundColor = "#f9fafb";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.fontSize = "14px";
    cancelBtn.style.fontWeight = "500";
    cancelBtn.style.color = "#374151";
    cancelBtn.addEventListener("click", () => {
      this.props.onCancel();
      this.close();
    });

    // Confirm button
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "confirmation-confirm";
    confirmBtn.textContent = this.props.confirmLabel || "Confirm";
    confirmBtn.style.padding = "8px 16px";
    confirmBtn.style.border = "none";
    confirmBtn.style.borderRadius = "4px";
    confirmBtn.style.cursor = "pointer";
    confirmBtn.style.fontSize = "14px";
    confirmBtn.style.fontWeight = "500";
    confirmBtn.style.color = "white";
    confirmBtn.style.backgroundColor = this.props.isDangerous ? "#ef4444" : "#3b82f6";
    confirmBtn.addEventListener("click", () => {
      this.props.onConfirm();
      this.close();
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    dialog.appendChild(buttonContainer);

    dialog.setAttribute("aria-labelledby", "dialog-title");
    dialog.setAttribute("aria-describedby", "dialog-message");

    this.container?.appendChild(backdrop);
    this.container?.appendChild(dialog);

    this.dialogElement = dialog;

    // Trigger fade-in
    setTimeout(() => {
      if (dialog) {
        dialog.style.opacity = "1";
      }
    }, 10);

    // Focus confirm button by default
    confirmBtn.focus();
  }

  private attachEventListeners(): void {
    if (!this.dialogElement) return;

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.props.onCancel();
        this.close();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const confirmBtn = this.dialogElement?.querySelector(
          ".confirmation-confirm"
        ) as HTMLButtonElement;
        if (confirmBtn) {
          this.props.onConfirm();
          this.close();
        }
      } else if (e.key === "Tab") {
        this.handleTabKey(e);
      }
    };

    const backdrop = this.container?.querySelector(".confirmation-backdrop") as HTMLElement;
    if (backdrop) {
      backdrop.addEventListener("click", () => {
        this.props.onCancel();
        this.close();
      });
    }

    this.dialogElement.addEventListener("keydown", handleKeydown);
  }

  private detachEventListeners(): void {
    if (!this.dialogElement) return;

    // Event listeners are automatically removed when element is removed
  }

  private handleTabKey(event: KeyboardEvent): void {
    if (!this.dialogElement) return;

    const buttons = this.dialogElement.querySelectorAll("button") as NodeListOf<HTMLButtonElement>;
    const focusedButton = document.activeElement as HTMLButtonElement;
    const focusedIndex = Array.from(buttons).indexOf(focusedButton);

    if (event.shiftKey) {
      // Shift+Tab
      if (focusedIndex <= 0) {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      }
    } else if (focusedIndex >= buttons.length - 1) {
      event.preventDefault();
      buttons[0].focus();
    }
  }

  unmount(): void {
    if (this.isOpen) {
      this.close();
    }
    this.container = null;
  }
}

export function createConfirmationDialog(props: ConfirmationDialogProps): ConfirmationDialog {
  return new ConfirmationDialog(props);
}
