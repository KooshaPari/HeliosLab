/**
 * Core types for the Zellij mux session adapter.
 */

/** Represents a zellij session as reported by `zellij list-sessions`. */
export interface ZellijSession {
  name: string;
  created: Date;
  attached: boolean;
}

/** Options for creating a new mux session. */
export interface SessionOptions {
  layout?: string | undefined;
  cwd?: string | undefined;
}

/** A pane record within a mux session. */
export interface PaneRecord {
  id: number;
  title: string;
  command?: string | undefined;
  dimensions?: PaneDimensions | undefined;
  ptyId?: string | undefined;
  createdAt?: Date | undefined;
}

/** Dimensions for a pane. */
export interface PaneDimensions {
  cols: number;
  rows: number;
}

/** Options for creating a new pane. */
export interface CreatePaneOptions {
  direction?: "horizontal" | "vertical";
  cwd?: string;
}

/** A tab record within a mux session. */
export interface TabRecord {
  index: number;
  name: string;
  panes: PaneRecord[];
  createdAt?: Date | undefined;
}

/** A fully resolved mux session with lane binding information. */
export interface MuxSession {
  sessionName: string;
  laneId: string;
  createdAt: Date;
  panes: PaneRecord[];
  tabs: TabRecord[];
}

/** A binding between a mux session and a lane. */
export interface MuxBinding {
  sessionName: string;
  laneId: string;
  session: MuxSession;
  boundAt: Date;
}

/** Result of a CLI command execution. */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Result of a zellij availability check. */
export interface AvailabilityResult {
  available: boolean;
  version?: string | undefined;
  path?: string | undefined;
}

/** Topology of a single pane within a layout. */
export interface PaneTopology {
  paneId: number;
  ptyId?: string | undefined;
  dimensions: PaneDimensions;
  focused: boolean;
}

/** Topology of a single tab within a session. */
export interface TabTopology {
  tabId: number;
  name: string;
  panes: PaneTopology[];
  layout: "horizontal" | "vertical" | "stacked";
}

/** Full layout topology for a session. */
export interface LayoutTopology {
  sessionName: string;
  tabs: TabTopology[];
  activeTabId: number;
}

/** Minimum pane dimension configuration. */
export interface MinPaneDimensions {
  minCols: number;
  minRows: number;
}

/**
 * Interface for PTY manager integration (spec 007).
 * Allows dependency injection and testing without requiring
 * the actual PTY lifecycle manager.
 */
export interface PtyManagerInterface {
  spawn(options: {
    laneId: string;
    sessionId: string;
    terminalId: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }): Promise<{ ptyId: string; pid: number }>;
  terminate(ptyId: string): Promise<void>;
  resize(ptyId: string, cols: number, rows: number): void;
}
