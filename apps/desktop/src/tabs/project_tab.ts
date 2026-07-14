import { TabSurface, type TabState, type ActiveContext } from "./tab_surface";

export interface LaneInfo {
  laneId: string;
  name: string;
  state: "active" | "inactive" | "paused";
  createdAt: string;
}

export interface ProjectTabState extends TabState {
  expandedSections?: string[];
}

export interface ProjectMetadata {
  projectName: string;
  workspacePath: string;
  lanesCount: number;
  lanes: LaneInfo[];
  gitStatus?: string;
  recentActivity?: string;
}

/**
 * ProjectTab displays project metadata and workspace information.
 *
 * Features:
 * - Shows project name and workspace path
 * - Displays all lanes with their states
 * - Shows git status summary
 * - Provides quick actions (create lane, open in file manager)
 * - Handles workspace unavailability gracefully
 */
export class ProjectTab extends TabSurface {
  private metadata: ProjectMetadata | null = null;
  private expandedSections = new Set<string>(["lanes", "info"]);
  private contentEl: HTMLElement | null = null;

  constructor() {
    super("project-tab", "project", "Project");
  }

  async onContextChange(context: ActiveContext | null): Promise<void> {
    // When context changes, query workspace/project metadata
    this.metadata = null;

    if (!context) {
      return;
    }

    // In a real implementation, query workspace registry:
    // const workspace = await workspaceRegistry.getWorkspace(context.workspaceId);
    // this.metadata = workspace.metadata;

    // Simulate: generate mock project metadata
    this.metadata = {
      projectName: "Helios",
      workspacePath: `/workspace/${context.workspaceId}`,
      lanesCount: 3,
      lanes: [
        {
          laneId: context.laneId,
          name: "Current Lane",
          state: "active",
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          laneId: "lane-2",
          name: "Feature Branch",
          state: "inactive",
          createdAt: new Date(Date.now() - 172800000).toISOString(),
        },
        {
          laneId: "lane-3",
          name: "Experimental",
          state: "paused",
          createdAt: new Date(Date.now() - 604800000).toISOString(),
        },
      ],
      gitStatus: "On branch main, 3 commits ahead of origin/main",
      recentActivity: "Last update 10 minutes ago",
    };
  }

  render(): HTMLElement {
    const container = document.createElement("div");
    container.className = "project-tab";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%";
    container.style.backgroundColor = "#f5f5f5";
    container.style.overflow = "hidden";

    if (!this.metadata) {
      const errorEl = document.createElement("div");
      errorEl.style.flex = "1";
      errorEl.style.display = "flex";
      errorEl.style.flexDirection = "column";
      errorEl.style.alignItems = "center";
      errorEl.style.justifyContent = "center";
      errorEl.style.color = "#d32f2f";
      errorEl.style.gap = "12px";

      const titleEl = document.createElement("div");
      titleEl.style.fontWeight = "600";
      titleEl.textContent = "Workspace Unavailable";

      const msgEl = document.createElement("div");
      msgEl.style.fontSize = "13px";
      msgEl.style.textAlign = "center";
      msgEl.style.color = "#999";
      msgEl.textContent = "The workspace could not be loaded. Check that it is still accessible.";

      const retryBtn = document.createElement("button");
      retryBtn.textContent = "Retry";
      retryBtn.style.padding = "6px 12px";
      retryBtn.style.backgroundColor = "#d32f2f";
      retryBtn.style.color = "white";
      retryBtn.style.border = "none";
      retryBtn.style.borderRadius = "3px";
      retryBtn.style.cursor = "pointer";
      retryBtn.style.fontSize = "12px";
      retryBtn.addEventListener("click", () => {
        console.log("Retry workspace load");
      });

      errorEl.appendChild(titleEl);
      errorEl.appendChild(msgEl);
      errorEl.appendChild(retryBtn);
      container.appendChild(errorEl);
      return container;
    }

    const scrollEl = document.createElement("div");
    scrollEl.style.flex = "1";
    scrollEl.style.overflow = "auto";
    scrollEl.style.padding = "16px";

    // Project Info Section
    const infoSectionEl = this.renderSection(
      "info",
      "Project Information",
      this.renderProjectInfo()
    );
    scrollEl.appendChild(infoSectionEl);

    // Lanes Section
    const lanesSectionEl = this.renderSection("lanes", "Lanes", this.renderLanesInfo());
    scrollEl.appendChild(lanesSectionEl);

    // Actions Section
    const actionsSectionEl = this.renderActionsSection();
    scrollEl.appendChild(actionsSectionEl);

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

  private renderProjectInfo(): HTMLElement {
    if (!this.metadata) {
      return document.createElement("div");
    }

    const container = document.createElement("div");
    container.style.display = "grid";
    container.style.gridTemplateColumns = "1fr";
    container.style.gap = "12px";

    const rows = [
      ["Project Name", this.metadata.projectName],
      ["Workspace Path", this.metadata.workspacePath],
      ["Active Lanes", this.metadata.lanesCount.toString()],
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

    // Git Status
    if (this.metadata.gitStatus) {
      const gitEl = document.createElement("div");

      const gitLabelEl = document.createElement("div");
      gitLabelEl.style.fontSize = "12px";
      gitLabelEl.style.color = "#999";
      gitLabelEl.style.marginBottom = "4px";
      gitLabelEl.textContent = "Git Status";

      const gitValueEl = document.createElement("div");
      gitValueEl.style.fontSize = "12px";
      gitValueEl.style.color = "#666";
      gitValueEl.style.fontFamily = "monospace";
      gitValueEl.textContent = this.metadata.gitStatus;

      gitEl.appendChild(gitLabelEl);
      gitEl.appendChild(gitValueEl);
      container.appendChild(gitEl);
    }

    return container;
  }

  private renderLanesInfo(): HTMLElement {
    if (!this.metadata) {
      return document.createElement("div");
    }

    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";

    for (const lane of this.metadata.lanes) {
      const laneEl = document.createElement("div");
      laneEl.style.padding = "12px";
      laneEl.style.backgroundColor = "#f5f5f5";
      laneEl.style.borderRadius = "3px";
      laneEl.style.border = "1px solid #e0e0e0";

      const headerEl = document.createElement("div");
      headerEl.style.display = "flex";
      headerEl.style.alignItems = "center";
      headerEl.style.gap = "8px";
      headerEl.style.marginBottom = "4px";

      const stateIndicatorEl = document.createElement("span");
      stateIndicatorEl.style.width = "6px";
      stateIndicatorEl.style.height = "6px";
      stateIndicatorEl.style.borderRadius = "50%";
      stateIndicatorEl.style.display = "inline-block";

      if (lane.state === "active") {
        stateIndicatorEl.style.backgroundColor = "#4caf50";
      } else if (lane.state === "paused") {
        stateIndicatorEl.style.backgroundColor = "#ff9800";
      } else {
        stateIndicatorEl.style.backgroundColor = "#999";
      }

      const nameEl = document.createElement("span");
      nameEl.style.fontWeight = "600";
      nameEl.style.color = "#333";
      nameEl.textContent = lane.name;

      const stateEl = document.createElement("span");
      stateEl.style.fontSize = "11px";
      stateEl.style.color = "#999";
      stateEl.style.marginLeft = "auto";
      stateEl.textContent = lane.state;

      headerEl.appendChild(stateIndicatorEl);
      headerEl.appendChild(nameEl);
      headerEl.appendChild(stateEl);

      const infoEl = document.createElement("div");
      infoEl.style.fontSize = "11px";
      infoEl.style.color = "#999";
      infoEl.textContent = `ID: ${lane.laneId} • Created ${new Date(lane.createdAt).toLocaleDateString()}`;

      laneEl.appendChild(headerEl);
      laneEl.appendChild(infoEl);
      container.appendChild(laneEl);
    }

    return container;
  }

  private renderActionsSection(): HTMLElement {
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
    headerEl.style.fontWeight = "600";
    headerEl.style.color = "#333";
    headerEl.textContent = "Quick Actions";

    const bodyEl = document.createElement("div");
    bodyEl.style.padding = "12px 16px";
    bodyEl.style.display = "flex";
    bodyEl.style.flexDirection = "column";
    bodyEl.style.gap = "8px";

    const createBtn = document.createElement("button");
    createBtn.textContent = "Create New Lane";
    createBtn.style.padding = "8px 12px";
    createBtn.style.backgroundColor = "#2196f3";
    createBtn.style.color = "white";
    createBtn.style.border = "none";
    createBtn.style.borderRadius = "3px";
    createBtn.style.cursor = "pointer";
    createBtn.style.fontSize = "12px";
    createBtn.style.width = "100%";
    createBtn.addEventListener("click", () => {
      console.log("Create lane action triggered");
    });

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open in File Manager";
    openBtn.style.padding = "8px 12px";
    openBtn.style.backgroundColor = "#607d8b";
    openBtn.style.color = "white";
    openBtn.style.border = "none";
    openBtn.style.borderRadius = "3px";
    openBtn.style.cursor = "pointer";
    openBtn.style.fontSize = "12px";
    openBtn.style.width = "100%";
    openBtn.addEventListener("click", () => {
      console.log("Open workspace in file manager");
    });

    bodyEl.appendChild(createBtn);
    bodyEl.appendChild(openBtn);

    sectionEl.appendChild(headerEl);
    sectionEl.appendChild(bodyEl);

    return sectionEl;
  }

  getState(): ProjectTabState {
    const baseState = super.getState();
    return {
      ...baseState,
      expandedSections: Array.from(this.expandedSections),
    };
  }

  restoreState(state: ProjectTabState): void {
    super.restoreState(state);
    if (state.expandedSections) {
      this.expandedSections = new Set(state.expandedSections);
    }
  }
}
