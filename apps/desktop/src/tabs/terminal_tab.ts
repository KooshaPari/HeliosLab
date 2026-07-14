import { TabSurface, type TabState, type ActiveContext } from "./tab_surface";

export interface TerminalTabState extends TabState {
  terminalId?: string;
  scrollPosition?: number;
  lastOutputLine?: number;
}

/**
 * TerminalTab displays the active terminal for the current lane/session.
 *
 * Features:
 * - Displays terminal renderer output or PTY stream
 * - Shows empty state when no terminal exists
 * - Handles renderer switches with loading indicator
 * - Supports terminal selection when multiple exist
 * - Persists scroll position and terminal selection
 */
export class TerminalTab extends TabSurface {
  private terminalId: string | null = null;
  private rendererSwitchInProgress: boolean = false;
  private contentEl: HTMLElement | null = null;
  private outputBuffer: string[] = [];

  constructor() {
    super("terminal-tab", "terminal", "Terminal");
  }

  async onContextChange(context: ActiveContext | null): Promise<void> {
    // When context changes, we would query the terminal registry
    // For now, simulate terminal availability
    if (!context) {
      this.terminalId = null;
      this.outputBuffer = [];
      return;
    }

    // In a real implementation, query terminal registry:
    // const terminals = await terminalRegistry.getTerminalsFor(context.laneId, context.sessionId);
    // this.terminalId = terminals.length > 0 ? terminals[0].id : null;

    // Simulate: always have a terminal in the active context
    this.terminalId = `term-${context.laneId}-${context.sessionId}`;
    this.outputBuffer = this.generateMockTerminalOutput(context);
  }

  render(): HTMLElement {
    const container = document.createElement("div");
    container.className = "terminal-tab";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%";
    container.style.backgroundColor = "#1e1e1e";
    container.style.color = "#d4d4d4";
    container.style.fontFamily = "monospace";
    container.style.fontSize = "13px";
    container.style.overflow = "hidden";

    if (this.rendererSwitchInProgress) {
      // Show loading indicator during renderer switch
      const loadingEl = document.createElement("div");
      loadingEl.style.display = "flex";
      loadingEl.style.alignItems = "center";
      loadingEl.style.justifyContent = "center";
      loadingEl.style.height = "100%";
      loadingEl.style.color = "#999";

      const spinnerEl = document.createElement("div");
      spinnerEl.textContent = "⏳ Switching renderer...";
      spinnerEl.style.fontSize = "16px";

      loadingEl.appendChild(spinnerEl);
      container.appendChild(loadingEl);
      return container;
    }

    if (!this.terminalId) {
      // Empty state: no terminal
      const emptyEl = document.createElement("div");
      emptyEl.style.display = "flex";
      emptyEl.style.flexDirection = "column";
      emptyEl.style.alignItems = "center";
      emptyEl.style.justifyContent = "center";
      emptyEl.style.height = "100%";
      emptyEl.style.color = "#666";
      emptyEl.style.gap = "16px";

      const messageEl = document.createElement("div");
      messageEl.style.fontSize = "14px";
      messageEl.textContent = "No terminal for this lane";

      const actionEl = document.createElement("button");
      actionEl.textContent = "Create Terminal";
      actionEl.style.padding = "8px 16px";
      actionEl.style.backgroundColor = "#007acc";
      actionEl.style.color = "white";
      actionEl.style.border = "none";
      actionEl.style.borderRadius = "4px";
      actionEl.style.cursor = "pointer";
      actionEl.style.fontSize = "13px";

      actionEl.addEventListener("click", () => {
        // Would trigger terminal creation via event bus
        console.log("Create terminal action triggered");
      });

      emptyEl.appendChild(messageEl);
      emptyEl.appendChild(actionEl);
      container.appendChild(emptyEl);
      return container;
    }

    // Terminal output
    const outputEl = document.createElement("div");
    outputEl.className = "terminal-output";
    outputEl.style.flex = "1";
    outputEl.style.overflow = "auto";
    outputEl.style.padding = "8px";
    outputEl.style.whiteSpace = "pre-wrap";
    outputEl.style.wordWrap = "break-word";
    outputEl.style.fontFamily = "monospace";

    for (const line of this.outputBuffer) {
      const lineEl = document.createElement("div");
      lineEl.textContent = line;
      lineEl.style.margin = "0";
      outputEl.appendChild(lineEl);
    }

    // Input prompt
    const promptEl = document.createElement("div");
    promptEl.style.padding = "8px";
    promptEl.style.borderTop = "1px solid #333";
    promptEl.style.display = "flex";
    promptEl.style.gap = "4px";

    const promptTextEl = document.createElement("span");
    promptTextEl.textContent = "$ ";
    promptTextEl.style.color = "#00d000";

    const inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.style.flex = "1";
    inputEl.style.backgroundColor = "#1e1e1e";
    inputEl.style.color = "#d4d4d4";
    inputEl.style.border = "none";
    inputEl.style.outline = "none";
    inputEl.style.fontFamily = "monospace";
    inputEl.style.fontSize = "13px";
    inputEl.placeholder = "Type command...";
    inputEl.style.paddingLeft = "4px";

    inputEl.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const command = inputEl.value;
        if (command) {
          this.outputBuffer.push(`$ ${command}`);
          this.outputBuffer.push("Command executed (mock)");
          inputEl.value = "";
          // Would send command via event bus
        }
      }
    });

    promptEl.appendChild(promptTextEl);
    promptEl.appendChild(inputEl);

    container.appendChild(outputEl);
    container.appendChild(promptEl);

    this.contentEl = container;
    return container;
  }

  getState(): TerminalTabState {
    const baseState = super.getState();
    return {
      ...baseState,
      terminalId: this.terminalId ?? undefined,
      scrollPosition: this.contentEl?.scrollTop,
      lastOutputLine: this.outputBuffer.length,
    };
  }

  restoreState(state: TerminalTabState): void {
    super.restoreState(state);
    if (state.terminalId) {
      this.terminalId = state.terminalId;
    }
    if (this.contentEl && state.scrollPosition) {
      this.contentEl.scrollTop = state.scrollPosition;
    }
  }

  /**
   * Simulate renderer switch progress.
   */
  setRendererSwitchInProgress(inProgress: boolean): void {
    this.rendererSwitchInProgress = inProgress;
  }

  /**
   * Generate mock terminal output for demonstration.
   */
  private generateMockTerminalOutput(context: ActiveContext): string[] {
    return [
      `$ cd /workspace/${context.workspaceId}`,
      `workspace $ cd lanes/${context.laneId}`,
      `lane $ ls -la`,
      `total 42`,
      `drwxr-xr-x  5 user  staff   160 Mar  1 10:00 .`,
      `drwxr-xr-x  3 user  staff    96 Mar  1 09:00 ..`,
      `-rw-r--r--  1 user  staff  1024 Mar  1 10:00 README.md`,
      `drwxr-xr-x  2 user  staff    64 Mar  1 10:00 src`,
      `$ `,
    ];
  }
}
