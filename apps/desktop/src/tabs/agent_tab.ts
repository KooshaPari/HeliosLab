import { TabSurface, type TabState, type ActiveContext } from "./tab_surface";

export interface AgentAction {
  timestamp: string;
  action: string;
  status: "pending" | "success" | "error";
  output?: string;
}

export interface AgentTabState extends TabState {
  agentStatus?: "idle" | "running" | "error";
  scrollPosition?: number;
  actionCount?: number;
}

/**
 * AgentTab displays agent activity and output for the current lane/session.
 *
 * Features:
 * - Shows agent status (idle, running, error)
 * - Displays recent actions and output log
 * - Handles agent errors gracefully
 * - Provides action buttons to manage agent
 * - Persists scroll position in output log
 */
export class AgentTab extends TabSurface {
  private agentStatus: "idle" | "running" | "error" = "idle";
  private actions: AgentAction[] = [];
  protected override errorMessage: string | null = null;
  private contentEl: HTMLElement | null = null;

  constructor() {
    super("agent-tab", "agent", "Agent");
  }

  async onContextChange(context: ActiveContext | null): Promise<void> {
    // When context changes, query agent state for this session
    this.actions = [];
    this.errorMessage = null;

    if (!context) {
      this.agentStatus = "idle";
      return;
    }

    // In a real implementation, query agent registry:
    // const agentState = await agentRegistry.getAgentState(context.sessionId);
    // this.agentStatus = agentState.status;
    // this.actions = agentState.recentActions;

    // Simulate: generate mock agent activity
    this.agentStatus = "idle";
    this.generateMockAgentActions(context);
  }

  render(): HTMLElement {
    const container = document.createElement("div");
    container.className = "agent-tab";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%";
    container.style.backgroundColor = "#f5f5f5";
    container.style.overflow = "hidden";

    // Status header
    const headerEl = document.createElement("div");
    headerEl.style.padding = "12px 16px";
    headerEl.style.borderBottom = "1px solid #e0e0e0";
    headerEl.style.backgroundColor = "#fafafa";
    headerEl.style.display = "flex";
    headerEl.style.alignItems = "center";
    headerEl.style.gap = "8px";

    const statusIndicatorEl = document.createElement("span");
    statusIndicatorEl.style.width = "10px";
    statusIndicatorEl.style.height = "10px";
    statusIndicatorEl.style.borderRadius = "50%";
    statusIndicatorEl.style.display = "inline-block";

    if (this.agentStatus === "running") {
      statusIndicatorEl.style.backgroundColor = "#4caf50";
      statusIndicatorEl.title = "Agent running";
    } else if (this.agentStatus === "error") {
      statusIndicatorEl.style.backgroundColor = "#f44336";
      statusIndicatorEl.title = "Agent error";
    } else {
      statusIndicatorEl.style.backgroundColor = "#999";
      statusIndicatorEl.title = "Agent idle";
    }

    const statusTextEl = document.createElement("span");
    statusTextEl.style.fontWeight = "600";
    statusTextEl.style.color = "#333";
    statusTextEl.textContent = `Agent Status: ${this.agentStatus.toUpperCase()}`;

    headerEl.appendChild(statusIndicatorEl);
    headerEl.appendChild(statusTextEl);
    container.appendChild(headerEl);

    // Error message (if any)
    if (this.errorMessage) {
      const errorEl = document.createElement("div");
      errorEl.style.padding = "12px 16px";
      errorEl.style.backgroundColor = "#ffebee";
      errorEl.style.color = "#d32f2f";
      errorEl.style.borderBottom = "1px solid #e0e0e0";
      errorEl.style.fontSize = "12px";
      errorEl.textContent = this.errorMessage;
      container.appendChild(errorEl);
    }

    // Actions log
    if (this.actions.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.style.flex = "1";
      emptyEl.style.display = "flex";
      emptyEl.style.alignItems = "center";
      emptyEl.style.justifyContent = "center";
      emptyEl.style.color = "#999";
      emptyEl.textContent = "No agent activity for this lane";
      container.appendChild(emptyEl);
    } else {
      const logEl = document.createElement("div");
      logEl.className = "agent-log";
      logEl.style.flex = "1";
      logEl.style.overflow = "auto";
      logEl.style.padding = "12px 16px";

      for (const action of this.actions) {
        const actionEl = this.renderAction(action);
        logEl.appendChild(actionEl);
      }

      container.appendChild(logEl);
    }

    // Action buttons
    const footerEl = document.createElement("div");
    footerEl.style.padding = "12px 16px";
    footerEl.style.borderTop = "1px solid #e0e0e0";
    footerEl.style.backgroundColor = "#fafafa";
    footerEl.style.display = "flex";
    footerEl.style.gap = "8px";

    const restartBtn = document.createElement("button");
    restartBtn.textContent = "Restart";
    restartBtn.style.padding = "6px 12px";
    restartBtn.style.backgroundColor = "#2196f3";
    restartBtn.style.color = "white";
    restartBtn.style.border = "none";
    restartBtn.style.borderRadius = "3px";
    restartBtn.style.cursor = "pointer";
    restartBtn.style.fontSize = "12px";
    restartBtn.addEventListener("click", () => {
      this.agentStatus = "running";
      console.log("Restart agent action triggered");
    });

    const logBtn = document.createElement("button");
    logBtn.textContent = "Full Log";
    logBtn.style.padding = "6px 12px";
    logBtn.style.backgroundColor = "#607d8b";
    logBtn.style.color = "white";
    logBtn.style.border = "none";
    logBtn.style.borderRadius = "3px";
    logBtn.style.cursor = "pointer";
    logBtn.style.fontSize = "12px";
    logBtn.addEventListener("click", () => {
      console.log("View full log action triggered");
    });

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.style.padding = "6px 12px";
    copyBtn.style.backgroundColor = "#607d8b";
    copyBtn.style.color = "white";
    copyBtn.style.border = "none";
    copyBtn.style.borderRadius = "3px";
    copyBtn.style.cursor = "pointer";
    copyBtn.style.fontSize = "12px";
    copyBtn.addEventListener("click", async () => {
      const text = this.actions.map(a => `[${a.timestamp}] ${a.action}: ${a.output}`).join("\n");
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        console.error("Failed to copy to clipboard");
      }
    });

    footerEl.appendChild(restartBtn);
    footerEl.appendChild(logBtn);
    footerEl.appendChild(copyBtn);
    container.appendChild(footerEl);

    this.contentEl = container;
    return container;
  }

  private renderAction(action: AgentAction): HTMLElement {
    const _el = document.createElement("div");
    el.style.marginBottom = "12px";
    el.style.paddingBottom = "12px";
    el.style.borderBottom = "1px solid #e0e0e0";

    const headerEl = document.createElement("div");
    headerEl.style.display = "flex";
    headerEl.style.alignItems = "center";
    headerEl.style.gap = "8px";
    headerEl.style.marginBottom = "4px";

    const statusEl = document.createElement("span");
    if (action.status === "success") {
      statusEl.textContent = "✓";
      statusEl.style.color = "#4caf50";
    } else if (action.status === "error") {
      statusEl.textContent = "✗";
      statusEl.style.color = "#f44336";
    } else {
      statusEl.textContent = "⟳";
      statusEl.style.color = "#ff9800";
    }

    const actionTextEl = document.createElement("span");
    actionTextEl.style.fontWeight = "600";
    actionTextEl.style.color = "#333";
    actionTextEl.textContent = action.action;

    const timeEl = document.createElement("span");
    timeEl.style.color = "#999";
    timeEl.style.fontSize = "12px";
    timeEl.textContent = action.timestamp;
    timeEl.style.marginLeft = "auto";

    headerEl.appendChild(statusEl);
    headerEl.appendChild(actionTextEl);
    headerEl.appendChild(timeEl);

    el.appendChild(headerEl);

    if (action.output) {
      const outputEl = document.createElement("div");
      outputEl.style.backgroundColor = "#fff";
      outputEl.style.padding = "8px";
      outputEl.style.borderRadius = "3px";
      outputEl.style.fontSize = "12px";
      outputEl.style.color = "#666";
      outputEl.style.fontFamily = "monospace";
      outputEl.style.whiteSpace = "pre-wrap";
      outputEl.style.wordWrap = "break-word";
      outputEl.textContent = action.output;
      el.appendChild(outputEl);
    }

    return el;
  }

  getState(): AgentTabState {
    const baseState = super.getState();
    return {
      ...baseState,
      agentStatus: this.agentStatus,
      scrollPosition: this.contentEl?.scrollTop,
      actionCount: this.actions.length,
    };
  }

  restoreState(state: AgentTabState): void {
    super.restoreState(state);
    if (state.agentStatus) {
      this.agentStatus = state.agentStatus;
    }
    if (this.contentEl && state.scrollPosition) {
      this.contentEl.scrollTop = state.scrollPosition;
    }
  }

  /**
   * Generate mock agent actions for demonstration.
   */
  private generateMockAgentActions(context: ActiveContext): void {
    const now = new Date();
    this.actions = [
      {
        timestamp: new Date(now.getTime() - 10000).toISOString(),
        action: "Initialize session",
        status: "success",
        output: `Session ${context.sessionId} initialized`,
      },
      {
        timestamp: new Date(now.getTime() - 5000).toISOString(),
        action: "Analyze context",
        status: "success",
        output: `Analyzed workspace ${context.workspaceId}`,
      },
      {
        timestamp: now.toISOString(),
        action: "Waiting for commands",
        status: "pending",
      },
    ];
  }
}
