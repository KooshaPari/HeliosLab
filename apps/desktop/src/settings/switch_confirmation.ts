/**
 * Switch Confirmation Dialog
 * Requires user confirmation before triggering a renderer switch
 */

export interface SwitchConfirmationProps {
  targetRendererName: string;
  supportsHotSwap: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export class SwitchConfirmation {
  private props: SwitchConfirmationProps;
  private container: HTMLElement | null = null;
  private isOpen: boolean = false;
  private previousFocus: HTMLElement | null = null;

  constructor(props: SwitchConfirmationProps) {
    this.props = props;
  }

  mount(container: HTMLElement): void {
    this.container = container;
  }

  unmount(): void {
    if (this.isOpen) {
      this.close();
    }
    this.container = null;
  }

  async open(): Promise<void> {
    if (this.isOpen || !this.container) return;

    this.previousFocus = document.activeElement as HTMLElement;
    this.isOpen = true;
    this.createAndShowDialog();
    this.attachEventListeners();
  }

  close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;
    this.detachEventListeners();

    const dialog = document.querySelector(".switch-confirmation-dialog") as HTMLElement;
    if (dialog) {
      dialog.style.opacity = "0";
      setTimeout(() => {
        const backdrop = document.querySelector(".switch-confirmation-backdrop");
        backdrop?.parentElement?.removeChild(backdrop);
        dialog?.parentElement?.removeChild(dialog);

        if (this.previousFocus) {
          this.previousFocus.focus();
        }
      }, 200);
    }
  }

  private createAndShowDialog(): void {
    if (!this.container) return;

    // Backdrop
    const backdrop = document.createElement("div");
    backdrop.className = "switch-confirmation-backdrop";
    backdrop.style.position = "fixed";
    backdrop.style.top = "0";
    backdrop.style.left = "0";
    backdrop.style.right = "0";
    backdrop.style.bottom = "0";
    backdrop.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    backdrop.style.zIndex = "1000";

    // Dialog
    const dialog = document.createElement("div");
    dialog.className = "switch-confirmation-dialog";
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
    dialog.style.maxWidth = "450px";
    dialog.style.zIndex = "1001";
    dialog.style.opacity = "0";
    dialog.style.transition = "opacity 200ms ease-in-out";

    // Title
    const title = document.createElement("h2");
    title.className = "switch-title";
    title.textContent = "Switch Renderer Engine?";
    title.id = "switch-dialog-title";
    title.style.margin = "0 0 12px 0";
    title.style.fontSize = "18px";
    title.style.fontWeight = "600";
    title.style.color = "#1f2937";
    dialog.appendChild(title);

    // Message
    const message = document.createElement("div");
    message.className = "switch-message";
    message.id = "switch-dialog-message";
    message.style.marginBottom = "20px";
    message.style.fontSize = "14px";
    message.style.lineHeight = "1.6";
    message.style.color = "#4b5563";

    const switchingTo = document.createElement("p");
    switchingTo.style.margin = "0 0 12px 0";
    switchingTo.textContent = `Switching to ${this.props.targetRendererName}...`;
    message.appendChild(switchingTo);

    const method = document.createElement("p");
    method.style.margin = "0 0 12px 0";
    if (this.props.supportsHotSwap) {
      method.textContent = "This will use hot-swap for a seamless transition (~3 seconds).";
      method.style.color = "#16a34a";
    } else {
      method.textContent = "This will restart the renderer with session restore (~8 seconds).";
      method.style.color = "#ea580c";
    }
    message.appendChild(method);

    const warning = document.createElement("p");
    warning.style.margin = "0";
    warning.style.padding = "8px";
    warning.style.backgroundColor = "#fef3c7";
    warning.style.borderLeft = "3px solid #eab308";
    warning.style.fontSize = "13px";
    warning.textContent = "All active terminals will be briefly interrupted.";
    message.appendChild(warning);

    dialog.appendChild(message);

    // Buttons
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "switch-buttons";
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "12px";
    buttonContainer.style.justifyContent = "flex-end";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "switch-cancel";
    cancelBtn.textContent = "Cancel";
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

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "switch-confirm";
    confirmBtn.textContent = "Switch";
    confirmBtn.style.padding = "8px 16px";
    confirmBtn.style.border = "none";
    confirmBtn.style.borderRadius = "4px";
    confirmBtn.style.backgroundColor = "#3b82f6";
    confirmBtn.style.color = "white";
    confirmBtn.style.cursor = "pointer";
    confirmBtn.style.fontSize = "14px";
    confirmBtn.style.fontWeight = "500";
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Switching...";
      try {
        await this.props.onConfirm();
      } finally {
        this.close();
      }
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    dialog.appendChild(buttonContainer);

    dialog.setAttribute("aria-labelledby", "switch-dialog-title");
    dialog.setAttribute("aria-describedby", "switch-dialog-message");

    this.container?.appendChild(backdrop);
    this.container?.appendChild(dialog);

    // Trigger fade-in
    setTimeout(() => {
      dialog.style.opacity = "1";
    }, 10);

    // Focus confirm button
    confirmBtn.focus();
  }

  private attachEventListeners(): void {
    const dialog = document.querySelector(".switch-confirmation-dialog") as HTMLElement;
    if (!dialog) return;

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.props.onCancel();
        this.close();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const confirmBtn = dialog.querySelector(".switch-confirm") as HTMLButtonElement;
        confirmBtn?.click();
      } else if (e.key === "Tab") {
        this.handleTabKey(e, dialog);
      }
    };

    const backdrop = document.querySelector(".switch-confirmation-backdrop") as HTMLElement;
    if (backdrop) {
      backdrop.addEventListener("click", () => {
        this.props.onCancel();
        this.close();
      });
    }

    dialog.addEventListener("keydown", handleKeydown);
  }

  private detachEventListeners(): void {
    // Event listeners are automatically removed when element is removed
  }

  private handleTabKey(event: KeyboardEvent, dialog: HTMLElement): void {
    const buttons = dialog.querySelectorAll("button") as NodeListOf<HTMLButtonElement>;
    const focusedButton = document.activeElement as HTMLButtonElement;
    const focusedIndex = Array.from(buttons).indexOf(focusedButton);

    if (event.shiftKey) {
      // Shift+Tab
      if (focusedIndex <= 0) {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      } else if (focusedIndex >= buttons.length - 1) {
        event.preventDefault();
        buttons[0].focus();
      }
    }
  }
}

export function createSwitchConfirmation(props: SwitchConfirmationProps): SwitchConfirmation {
  return new SwitchConfirmation(props);
}
