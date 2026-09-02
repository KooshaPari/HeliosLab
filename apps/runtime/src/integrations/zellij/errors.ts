/**
 * Custom error types for zellij integration.
 */

export class ZellijNotFoundError extends Error {
  constructor() {
    super(
      "zellij binary not found in PATH. " +
        "Install zellij: https://zellij.dev/documentation/installation"
    );
    this.name = "ZellijNotFoundError";
  }
}

export class ZellijVersionError extends Error {
  constructor(actual: string, required: string) {
    super(
      `zellij version ${actual} is below the minimum required ${required}. ` +
        "Please upgrade: https://zellij.dev/documentation/installation"
    );
    this.name = "ZellijVersionError";
  }
}

export class ZellijCliError extends Error {
  public readonly exitCode: number;
  public readonly stderr: string;

  constructor(command: string, exitCode: number, stderr: string) {
    super(`zellij command failed (exit ${exitCode}): ${command}\n${stderr}`);
    this.name = "ZellijCliError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class ZellijTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`zellij command timed out after ${timeoutMs}ms: ${command}`);
    this.name = "ZellijTimeoutError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionName: string) {
    super(`zellij session not found: ${sessionName}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionAlreadyExistsError extends Error {
  constructor(sessionName: string) {
    super(`zellij session already exists: ${sessionName}`);
    this.name = "SessionAlreadyExistsError";
  }
}

export class DuplicateBindingError extends Error {
  constructor(key: string, existing: string) {
    super(`Binding conflict: ${key} already bound to ${existing}`);
    this.name = "DuplicateBindingError";
  }
}

export class PaneTooSmallError extends Error {
  public readonly requestedCols: number;
  public readonly requestedRows: number;
  public readonly minCols: number;
  public readonly minRows: number;

  constructor(requestedCols: number, requestedRows: number, minCols: number, minRows: number) {
    super(
      `Pane dimensions ${requestedCols}x${requestedRows} violate minimum ` + `${minCols}x${minRows}`
    );
    this.name = "PaneTooSmallError";
    this.requestedCols = requestedCols;
    this.requestedRows = requestedRows;
    this.minCols = minCols;
    this.minRows = minRows;
  }
}

export class PaneNotFoundError extends Error {
  constructor(sessionName: string, paneId: number) {
    super(`Pane ${paneId} not found in session ${sessionName}`);
    this.name = "PaneNotFoundError";
  }
}

export class TabNotFoundError extends Error {
  constructor(sessionName: string, tabId: number) {
    super(`Tab ${tabId} not found in session ${sessionName}`);
    this.name = "TabNotFoundError";
  }
}

export class PtyBindingError extends Error {
  constructor(paneId: number, reason: string) {
    super(`PTY binding failed for pane ${paneId}: ${reason}`);
    this.name = "PtyBindingError";
  }
}
