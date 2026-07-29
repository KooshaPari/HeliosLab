import { TabSurface, type TabState, type ActiveContext } from "./tab_surface";

export interface SessionTabState extends TabState {
  expandedSections?: string[];
}

export interface SessionMetadata {
  sessionId: string;
  createdAt: string;
  lifecycleState: string;
  harnessTransport: string;
  terminalCount: number;
  degradationReason?: string;
}

/**
 * SessionTab displays session metadata, lifecycle state, and diagnostics.
 *
 * Features:
 * - Shows session ID, creation time, and lifecycle state
 * - Displays harness transport mode (cliproxy_harness or native_openai)
 * - Shows degradation reasons if transport is degraded
 * - Displays session timeline with key lifecycle events
 * - Shows terminal count for the session
 */
export class SessionTab extends TabSurface {
  private metadata: SessionMetadata | null = null;
  private expandedSections = new Set<string>(["info", "diagnostics"]);
  private contentEl: HTMLElement | null = null;

  constructor() {
    super("session-tab", "session", "Session");
  }

  async onContextChange(context: ActiveContext | null): Promise<void> {
    // When context changes, query session metadata
    if (!context) {
      this.metadata = null;
      return;
    }

    // In a real implementation, query session registry:
    // const session = await sessionRegistry.getSession(context.sessionId);
    // this.metadata = session.metadata;

    // Simulate: generate mock session metadata
    this.metadata = {
      sessionId: context.sessionId,
      createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      lifecycleState: "active",
      harnessTransport: "cliproxy_harness",
      terminalCount: 2,
      degradationReason: undefined,
    };
  }

  render(): HTMLElement {
    const container = document.createElement("div");
    container.className = "session-tab";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%";
    container.style.backgroundColor = "#f5f5f5";
    container.style.overflow = "hidden";

    if (!this.metadata) {
      const emptyEl = document.createElement("div");
      emptyEl.style.flex = "1";
      emptyEl.style.display = "flex";
      emptyEl.style.alignItems = "center";
      emptyEl.style.justifyContent = "center";
      emptyEl.style.color = "#999";
      emptyEl.textContent = "No active session";
      container.appendChild(emptyEl);
      return container;
    }

    const scrollEl = document.createElement("div");
    scrollEl.style.flex = "1";
    scrollEl.style.overflow = "auto";
    scrollEl.style.padding = "16px";

    // Session Info Section
    const infoSectionEl = this.renderSection(
      "info",
      "Session Information",
      this.renderSessionInfo()
    );
    scrollEl.appendChild(infoSectionEl);

    // Diagnostics Section
    const diagSectionEl = this.renderSection(
      "diagnostics",
      "Diagnostics",
      this.renderDiagnostics()
    );
    scrollEl.appendChild(diagSectionEl);

    // Timeline Section
    const timelineSectionEl = this.renderSection("timeline", "Timeline", this.renderTimeline());
    scrollEl.appendChild(timelineSectionEl);

    container.appendChild(scrollEl);
    this.contentEl = container;
    return container;
  }

  private renderSection(sectionId: string, title: string, contentEl: HTMLElement): HTMLElement {
    const sectionEl = document.createElement("div");
    sectionEl.style.marginBottom = "16px";
    sectionEl.style.backgroundColor = "white";
    sectionEl.style.borderRadius = "4px";
    sectionEl.style.border = "1px solid #e0e0e0";
    sectionEl.style.overflow = "hidden";

    const headerEl = document.createElement("div");
    headerEl.style.padding = "12px 16px";
    headerEl.style.backgroundColor = "#f5f5f5";
    headerEl.style.borderBottom = "1px solid #e0e0e0";
    headerEl.style.cursor = "pointer";
    headerEl.style.display = "flex";
    headerEl.style.alignItems = "center";
    headerEl.style.gap = "8px";
    headerEl.style.userSelect = "none";

    const toggleEl = document.createElement("span");
    toggleEl.style.fontSize = "12px";
    toggleEl.style.color = "#666";
    toggleEl.textContent = this.expandedSections.has(sectionId) ? "▼" : "▶";

    const titleEl = document.createElement("span");
    titleEl.style.fontWeight = "600";
    titleEl.style.color = "#333";
    titleEl.textContent = title;

    headerEl.appendChild(toggleEl);
    headerEl.appendChild(titleEl);

    const bodyEl = document.createElement("div");
    bodyEl.style.padding = "16px";
    bodyEl.style.display = this.expandedSections.has(sectionId) ? "block" : "none";
    bodyEl.appendChild(contentEl);

    headerEl.addEventListener("click", () => {
      const isExpanded = this.expandedSections.has(sectionId);
      if (isExpanded) {
        this.expandedSections.delete(sectionId);
        bodyEl.style.display = "none";
        toggleEl.textContent = "▶";
      } else {
        this.expandedSections.add(sectionId);
        bodyEl.style.display = "block";
        toggleEl.textContent = "▼";
      }
    });

    sectionEl.appendChild(headerEl);
    sectionEl.appendChild(bodyEl);

    return sectionEl;
  }

  private renderSessionInfo(): HTMLElement {
    if (!this.metadata) {
      return document.createElement("div");
    }

    const container = document.createElement("div");
    container.style.display = "grid";
    container.style.gridTemplateColumns = "1fr 1fr";
    container.style.gap = "12px";

    const rows = [
      ["Session ID", this.metadata.sessionId],
      ["Created", new Date(this.metadata.createdAt).toLocaleString()],
      ["Lifecycle State", this.metadata.lifecycleState],
      ["Terminal Count", this.metadata.terminalCount.toString()],
    ];

    for (const [label, value] of rows) {
      const rowEl = document.createElement("div");

      const labelEl = document.createElement("div");
      labelEl.style.fontSize = "12px";
      labelEl.style.color = "#999";
      labelEl.style.marginBottom = "4px";
      labelEl.textContent = label;

      const valueEl = document.createElement("div");
      valueEl.style.fontSize = "14px";
      valueEl.style.color = "#333";
      valueEl.style.fontWeight = "500";
      valueEl.textContent = value;

      rowEl.appendChild(labelEl);
      rowEl.appendChild(valueEl);
      container.appendChild(rowEl);
    }

    return container;
  }

  private renderDiagnostics(): HTMLElement {
    if (!this.metadata) {
      return document.createElement("div");
    }

    const container = document.createElement("div");

    // Transport Mode
    const transportEl = document.createElement("div");
    transportEl.style.marginBottom = "12px";

    const transportLabelEl = document.createElement("div");
    transportLabelEl.style.fontSize = "12px";
    transportLabelEl.style.color = "#999";
    transportLabelEl.style.marginBottom = "4px";
    transportLabelEl.textContent = "Harness Transport";

    const transportValueEl = document.createElement("div");
    transportValueEl.style.fontSize = "14px";
    transportValueEl.style.color = "#333";
    transportValueEl.style.fontWeight = "500";
    transportValueEl.style.display = "flex";
    transportValueEl.style.alignItems = "center";
    transportValueEl.style.gap = "8px";

    const indicatorEl = document.createElement("span");
    indicatorEl.style.width = "8px";
    indicatorEl.style.height = "8px";
    indicatorEl.style.borderRadius = "50%";
    indicatorEl.style.backgroundColor = "#4caf50";

    const textEl = document.createElement("span");
    textEl.textContent = this.metadata.harnessTransport;

    transportValueEl.appendChild(indicatorEl);
    transportValueEl.appendChild(textEl);

    transportEl.appendChild(transportLabelEl);
    transportEl.appendChild(transportValueEl);
    container.appendChild(transportEl);

    // Degradation (if applicable)
    if (this.metadata.degradationReason) {
      const degradeEl = document.createElement("div");
      degradeEl.style.padding = "12px";
      degradeEl.style.backgroundColor = "#fff3cd";
      degradeEl.style.border = "1px solid #ffc107";
      degradeEl.style.borderRadius = "3px";
      degradeEl.style.color = "#856404";
      degradeEl.style.fontSize = "12px";

      const titleEl = document.createElement("div");
      titleEl.style.fontWeight = "600";
      titleEl.style.marginBottom = "4px";
      titleEl.textContent = "Transport Degraded";

      const msgEl = document.createElement("div");
      msgEl.textContent = this.metadata.degradationReason;

      degradeEl.appendChild(titleEl);
      degradeEl.appendChild(msgEl);
      container.appendChild(degradeEl);
    }

    return container;
  }

  private renderTimeline(): HTMLElement {
    const container = document.createElement("div");

    const events = [
      { time: new Date(Date.now() - 3600000), event: "Session created" },
      { time: new Date(Date.now() - 1800000), event: "Terminal 1 spawned" },
      { time: new Date(Date.now() - 1200000), event: "Terminal 2 spawned" },
      { time: new Date(Date.now() - 600000), event: "Agent initialized" },
      { time: new Date(), event: "Current" },
    ];

    for (const { time, event } of events) {
      const eventEl = document.createElement("div");
      eventEl.style.display = "flex";
      eventEl.style.gap = "12px";
      eventEl.style.marginBottom = "12px";

      const timeEl = document.createElement("div");
      timeEl.style.fontSize = "12px";
      timeEl.style.color = "#999";
      timeEl.style.minWidth = "120px";
      timeEl.textContent = time.toLocaleTimeString();

      const dotEl = document.createElement("div");
      dotEl.style.width = "8px";
      dotEl.style.height = "8px";
      dotEl.style.borderRadius = "50%";
      dotEl.style.backgroundColor = "#2196f3";
      dotEl.style.marginTop = "4px";

      const msgEl = document.createElement("div");
      msgEl.style.fontSize = "13px";
      msgEl.style.color = "#333";
      msgEl.textContent = event;

      eventEl.appendChild(timeEl);
      eventEl.appendChild(dotEl);
      eventEl.appendChild(msgEl);
      container.appendChild(eventEl);
    }

    return container;
  }

  getState(): SessionTabState {
    const baseState = super.getState();
    return {
      ...baseState,
      expandedSections: Array.from(this.expandedSections),
    };
  }

  restoreState(state: SessionTabState): void {
    super.restoreState(state);
    if (state.expandedSections) {
      this.expandedSections = new Set(state.expandedSections);
    }
  }
}
