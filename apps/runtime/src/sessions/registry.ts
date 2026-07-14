import type {
  RecoveryBootstrapResult,
  RecoveryIssue,
  RecoveryLaneRecord,
  RecoveryMetadata,
  RecoverySessionRecord,
  RecoveryTerminalRecord,
  WatchdogScanResult,
} from "./types";

export type SessionTransport = "cliproxy_harness" | "native_openai";
export type SessionStatus = "detached" | "attaching" | "attached" | "terminated";

export type SessionRecord = {
  session_id: string;
  lane_id: string;
  codex_session_id: string;
  transport: SessionTransport;
  status: SessionStatus;
  last_heartbeat_at: string;
};

export type EnsureSessionInput = {
  lane_id: string;
  transport: SessionTransport;
  codex_session_id?: string;
};

type RecoveryLifecycleInput = {
  lane_id?: string | undefined;
  session_id?: string | undefined;
  terminal_id?: string | undefined;
  workspace_id?: string | undefined;
  codex_session_id?: string | undefined;
};

export class SessionRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionRegistryError";
  }
}

export class InMemorySessionRegistry {
  private readonly bySessionId = new Map<string, SessionRecord>();
  private readonly activeLaneSessions = new Map<string, string>();
  private readonly activeCodexSessions = new Map<string, string>();

  ensure(input: EnsureSessionInput): {
    session: SessionRecord;
    created: boolean;
  } {
    const nowIso = new Date().toISOString();
    const activeSessionId = this.activeLaneSessions.get(input.lane_id);
    if (activeSessionId) {
      const active = this.bySessionId.get(activeSessionId);
      if (!active) {
        this.activeLaneSessions.delete(input.lane_id);
      } else {
        if (input.codex_session_id && input.codex_session_id !== active.codex_session_id) {
          throw new SessionRegistryError(
            `lane ${input.lane_id} already mapped to codex session ${active.codex_session_id}`
          );
        }

        active.status = "attached";
        active.transport = input.transport;
        active.last_heartbeat_at = nowIso;
        return { session: { ...active }, created: false };
      }
    }

    const codexSessionId = input.codex_session_id ?? this.generateCodexSessionId();
    const codexCollision = this.activeCodexSessions.get(codexSessionId);
    if (codexCollision) {
      const colliding = this.bySessionId.get(codexCollision);
      if (colliding && colliding.status !== "terminated" && colliding.lane_id !== input.lane_id) {
        throw new SessionRegistryError(
          `codex session ${codexSessionId} already active on lane ${colliding.lane_id}`
        );
      }
    }

    const session: SessionRecord = {
      session_id: this.generateRuntimeSessionId(),
      lane_id: input.lane_id,
      codex_session_id: codexSessionId,
      transport: input.transport,
      status: "attached",
      last_heartbeat_at: nowIso,
    };

    this.bySessionId.set(session.session_id, session);
    this.activeLaneSessions.set(session.lane_id, session.session_id);
    this.activeCodexSessions.set(session.codex_session_id, session.session_id);
    return { session: { ...session }, created: true };
  }

  get(sessionId: string): SessionRecord | undefined {
    const session = this.bySessionId.get(sessionId);
    return session ? { ...session } : undefined;
  }

  listByLane(laneId: string): SessionRecord[] {
    const sessions: SessionRecord[] = [];
    for (const session of this.bySessionId.values()) {
      if (session.lane_id === laneId) {
        sessions.push({ ...session });
      }
    }
    return sessions;
  }

  heartbeat(sessionId: string): SessionRecord {
    const session = this.bySessionId.get(sessionId);
    if (!session) {
      throw new SessionRegistryError(`session ${sessionId} not found`);
    }

    session.last_heartbeat_at = new Date().toISOString();
    return { ...session };
  }

  terminate(sessionId: string): SessionRecord {
    const session = this.bySessionId.get(sessionId);
    if (!session) {
      throw new SessionRegistryError(`session ${sessionId} not found`);
    }

    session.status = "terminated";
    session.last_heartbeat_at = new Date().toISOString();
    this.activeLaneSessions.delete(session.lane_id);
    this.activeCodexSessions.delete(session.codex_session_id);
    return { ...session };
  }

  private generateRuntimeSessionId(): string {
    return `sess_${crypto.randomUUID()}`;
  }

  private generateCodexSessionId(): string {
    return `codex_${crypto.randomUUID()}`;
  }
}

export class RecoveryRegistry {
  private readonly lanes = new Map<string, RecoveryLaneRecord>();
  private readonly sessions = new Map<string, RecoverySessionRecord>();
  private readonly terminals = new Map<string, RecoveryTerminalRecord>();

  apply(method: string, input: RecoveryLifecycleInput): void {
    switch (method) {
      case "lane.create":
        this.onLaneCreate(input);
        return;
      case "lane.cleanup":
        this.onLaneCleanup(input);
        return;
      case "session.attach":
        this.onSessionAttach(input);
        return;
      case "session.terminate":
        this.onSessionTerminate(input);
        return;
      case "terminal.spawn":
        this.onTerminalSpawn(input);
        return;
      default:
        return;
    }
  }

  bootstrap(metadata: RecoveryMetadata): RecoveryBootstrapResult {
    this.lanes.clear();
    this.sessions.clear();
    this.terminals.clear();

    for (const lane of metadata.lanes) {
      this.lanes.set(lane.lane_id, { ...lane });
    }
    for (const session of metadata.sessions) {
      this.sessions.set(session.session_id, { ...session });
    }
    for (const terminal of metadata.terminals) {
      this.terminals.set(terminal.terminal_id, { ...terminal });
    }

    const issues: RecoveryIssue[] = [];
    const recovered_session_ids: string[] = [];

    for (const session of this.sessions.values()) {
      if (!session.codex_session_id) {
        issues.push({
          artifact_type: "session",
          artifact_id: session.session_id,
          reason: "missing codex_session_id",
          remediation: "cleanup",
          state: "unrecoverable",
        });
        continue;
      }

      if (!session.lane_id || !this.lanes.has(session.lane_id)) {
        session.status = "detached";
        issues.push({
          artifact_type: "session",
          artifact_id: session.session_id,
          reason: "missing lane mapping",
          remediation: "reattach",
          state: "recoverable",
        });
        continue;
      }

      session.status = "attached";
      recovered_session_ids.push(session.session_id);
    }

    return { recovered_session_ids, issues };
  }

  snapshot(): RecoveryMetadata {
    return {
      lanes: [...this.lanes.values()].map(lane => ({ ...lane })),
      sessions: [...this.sessions.values()].map(session => ({ ...session })),
      terminals: [...this.terminals.values()].map(terminal => ({
        ...terminal,
      })),
    };
  }

  scanForOrphans(nowIso: string): WatchdogScanResult {
    const issues: RecoveryIssue[] = [];

    for (const lane of this.lanes.values()) {
      if (lane.session_id && !this.sessions.has(lane.session_id)) {
        issues.push({
          artifact_type: "lane",
          artifact_id: lane.lane_id,
          reason: "references missing session",
          remediation: "reconcile",
          state: "recoverable",
        });
      }
      if (lane.terminal_id && !this.terminals.has(lane.terminal_id)) {
        issues.push({
          artifact_type: "lane",
          artifact_id: lane.lane_id,
          reason: "references missing terminal",
          remediation: "reconcile",
          state: "recoverable",
        });
      }
    }

    for (const session of this.sessions.values()) {
      const hasValidLane = Boolean(session.lane_id && this.lanes.has(session.lane_id));
      if (!hasValidLane) {
        if (session.status === "detached" && session.codex_session_id) {
          issues.push({
            artifact_type: "session",
            artifact_id: session.session_id,
            reason: "detached session can be reattached by codex_session_id",
            remediation: "reattach",
            state: "recoverable",
          });
        } else {
          issues.push({
            artifact_type: "session",
            artifact_id: session.session_id,
            reason: "session has no valid lane mapping",
            remediation: "cleanup",
            state: "unrecoverable",
          });
        }
      }

      if (session.terminal_id && !this.terminals.has(session.terminal_id)) {
        issues.push({
          artifact_type: "session",
          artifact_id: session.session_id,
          reason: "session references missing terminal",
          remediation: "reconcile",
          state: "recoverable",
        });
      }
    }

    for (const terminal of this.terminals.values()) {
      if (!terminal.session_id || !this.sessions.has(terminal.session_id)) {
        issues.push({
          artifact_type: "terminal",
          artifact_id: terminal.terminal_id,
          reason: "terminal has no valid session mapping",
          remediation: "cleanup",
          state: "unrecoverable",
        });
      }
    }

    return { scanned_at: nowIso, issues };
  }

  hasLane(laneId: string): boolean {
    return this.lanes.has(laneId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  hasTerminal(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }

  private onLaneCreate(input: RecoveryLifecycleInput): void {
    if (!input.lane_id || !input.workspace_id) {
      return;
    }

    const existing = this.lanes.get(input.lane_id);
    this.lanes.set(input.lane_id, {
      lane_id: input.lane_id,
      workspace_id: input.workspace_id,
      session_id: existing?.session_id,
      terminal_id: existing?.terminal_id,
    });
  }

  private onLaneCleanup(input: RecoveryLifecycleInput): void {
    if (!input.lane_id) {
      return;
    }

    this.lanes.delete(input.lane_id);
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lane_id === input.lane_id) {
        this.sessions.delete(sessionId);
      }
    }
    for (const [terminalId, terminal] of this.terminals.entries()) {
      if (terminal.lane_id === input.lane_id) {
        this.terminals.delete(terminalId);
      }
    }
  }

  private onSessionAttach(input: RecoveryLifecycleInput): void {
    if (!input.session_id || !input.workspace_id) {
      return;
    }

    const laneId = input.lane_id;
    if (laneId) {
      const lane = this.lanes.get(laneId);
      if (lane) {
        lane.session_id = input.session_id;
      }
    }

    const existing = this.sessions.get(input.session_id);
    this.sessions.set(input.session_id, {
      session_id: input.session_id,
      workspace_id: input.workspace_id,
      lane_id: laneId,
      codex_session_id: input.codex_session_id ?? existing?.codex_session_id,
      terminal_id: existing?.terminal_id,
      status: "attached",
    });
  }

  private onSessionTerminate(input: RecoveryLifecycleInput): void {
    if (!input.session_id) {
      return;
    }

    const session = this.sessions.get(input.session_id);
    if (!session) {
      return;
    }

    session.status = "terminated";
  }

  private onTerminalSpawn(input: RecoveryLifecycleInput): void {
    if (!input.terminal_id || !input.workspace_id) {
      return;
    }

    const lane = input.lane_id ? this.lanes.get(input.lane_id) : undefined;
    if (lane) {
      lane.terminal_id = input.terminal_id;
    }

    if (input.session_id) {
      const session = this.sessions.get(input.session_id);
      if (session) {
        session.terminal_id = input.terminal_id;
      }
    }

    this.terminals.set(input.terminal_id, {
      terminal_id: input.terminal_id,
      workspace_id: input.workspace_id,
      lane_id: input.lane_id,
      session_id: input.session_id,
      status: "active",
    });
  }
}
