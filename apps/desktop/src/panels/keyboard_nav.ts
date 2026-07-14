/**
 * Keyboard Navigation Module
 * Handles keyboard-first navigation for the lane list
 */

export interface KeyboardNavOptions {
  enableWrap?: boolean;
  confirmBeforeDelete?: boolean;
}

export interface KeyboardNavCallbacks {
  onNavigateUp: () => void;
  onNavigateDown: () => void;
  onNavigateHome: () => void;
  onNavigateEnd: () => void;
  onSelect: () => void;
  onDelete: () => Promise<boolean>; // Returns true if confirmed
}

export class KeyboardNav {
  private options: KeyboardNavOptions;
  private callbacks: KeyboardNavCallbacks;
  private container: HTMLElement | null = null;
  private keydownHandler?: (e: KeyboardEvent) => void;
  private currentIndex: number = 0;
  private itemCount: number = 0;

  constructor(callbacks: KeyboardNavCallbacks, options: KeyboardNavOptions = {}) {
    this.callbacks = callbacks;
    this.options = {
      enableWrap: false,
      confirmBeforeDelete: true,
      ...options,
    };
  }

  mount(container: HTMLElement): void {
    this.container = container;
    this.updateItemCount();
    this.attachEventListeners();
  }

  unmount(): void {
    this.detachEventListeners();
    this.container = null;
  }

  setItemCount(count: number): void {
    this.itemCount = count;
    // Clamp current index
    if (this.currentIndex >= count) {
      this.currentIndex = Math.max(0, count - 1);
    }
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  setCurrentIndex(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.itemCount - 1));
    this.currentIndex = clamped;
  }

  private updateItemCount(): void {
    if (!this.container) return;
    const items = this.container.querySelectorAll('[role="option"]');
    this.itemCount = items.length;
  }

  private attachEventListeners(): void {
    if (!this.container) return;

    this.keydownHandler = (e: KeyboardEvent) => {
      this.handleKeydown(e);
    };

    this.container.addEventListener("keydown", this.keydownHandler);
  }

  private detachEventListeners(): void {
    if (!this.container || !this.keydownHandler) return;
    this.container.removeEventListener("keydown", this.keydownHandler);
  }

  private handleKeydown(event: KeyboardEvent): void {
    const key = event.key;

    switch (key) {
      case "ArrowUp":
        this.handleNavigateUp(event);
        break;
      case "ArrowDown":
        this.handleNavigateDown(event);
        break;
      case "Home":
        this.handleNavigateHome(event);
        break;
      case "End":
        this.handleNavigateEnd(event);
        break;
      case "Enter":
        this.handleSelect(event);
        break;
      case "Delete":
      case "Backspace":
        this.handleDelete(event);
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  private handleNavigateUp(_event: KeyboardEvent): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.callbacks.onNavigateUp();
    } else if (this.options.enableWrap) {
      this.currentIndex = this.itemCount - 1;
      this.callbacks.onNavigateUp();
    }
  }

  private handleNavigateDown(_event: KeyboardEvent): void {
    if (this.currentIndex < this.itemCount - 1) {
      this.currentIndex++;
      this.callbacks.onNavigateDown();
    } else if (this.options.enableWrap) {
      this.currentIndex = 0;
      this.callbacks.onNavigateDown();
    }
  }

  private handleNavigateHome(_event: KeyboardEvent): void {
    this.currentIndex = 0;
    this.callbacks.onNavigateHome();
  }

  private handleNavigateEnd(_event: KeyboardEvent): void {
    this.currentIndex = Math.max(0, this.itemCount - 1);
    this.callbacks.onNavigateEnd();
  }

  private handleSelect(_event: KeyboardEvent): void {
    this.callbacks.onSelect();
  }

  private async handleDelete(_event: KeyboardEvent): Promise<void> {
    if (!this.options.confirmBeforeDelete) {
      this.callbacks.onDelete();
      return;
    }

    const confirmed = await this.callbacks.onDelete();
    if (confirmed) {
      // Adjust current index if needed
      if (this.currentIndex >= this.itemCount - 1 && this.currentIndex > 0) {
        this.currentIndex--;
      }
    }
  }
}

export function createKeyboardNav(
  callbacks: KeyboardNavCallbacks,
  options?: KeyboardNavOptions
): KeyboardNav {
  return new KeyboardNav(callbacks, options);
}
