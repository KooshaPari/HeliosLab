export type TerminalLifecycleState = "idle" | "spawning" | "active" | "throttled" | "closed";

export type TerminalContext = {
  terminal_id: string;
  workspace_id: string;
  lane_id: string;
  session_id: string;
  title: string;
  state: TerminalLifecycleState;
  last_output_seq: number;
};

type SpawnInput = {
  terminal_id: string;
  workspace_id: string;
  lane_id: string;
  session_id: string;
  title?: string;
};

type ExpectedContext = {
  workspace_id: string;
  lane_id: string;
  session_id: string;
};

export class TerminalRegistry {
  private readonly terminals = new Map<string, TerminalContext>();
  private readonly terminalsBySession = new Map<string, Set<string>>();

  spawn(input: SpawnInput): TerminalContext {
    const existing = this.terminals.get(input.terminal_id);
    if (existing) {
      const existingSessionSet = this.terminalsBySession.get(existing.session_id);
      if (existingSessionSet) {
        existingSessionSet.delete(existing.terminal_id);
        if (existingSessionSet.size === 0) {
          this.terminalsBySession.delete(existing.session_id);
        }
      }
    }

    const terminal: TerminalContext = {
      terminal_id: input.terminal_id,
      workspace_id: input.workspace_id,
      lane_id: input.lane_id,
      session_id: input.session_id,
      title: input.title ?? "Terminal",
      state: "spawning",
      last_output_seq: 0,
    };

    this.terminals.set(terminal.terminal_id, terminal);
    let sessionSet = this.terminalsBySession.get(terminal.session_id);
    if (!sessionSet) {
      sessionSet = new Set<string>();
      this.terminalsBySession.set(terminal.session_id, sessionSet);
    }
    sessionSet.add(terminal.terminal_id);
    return terminal;
  }

  get(terminalId: string): TerminalContext | undefined {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return undefined;
    }
    return { ...terminal };
  }

  listBySession(sessionId: string): TerminalContext[] {
    const terminalIds = this.terminalsBySession.get(sessionId);
    if (!terminalIds) {
      return [];
    }
    return Array.from(terminalIds)
      .map(terminalId => this.terminals.get(terminalId))
      .filter((terminal): terminal is TerminalContext => terminal !== undefined)
      .map(terminal => ({ ...terminal }));
  }

  setState(terminalId: string, state: TerminalLifecycleState): TerminalContext | undefined {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return undefined;
    }
    terminal.state = state;
    return { ...terminal };
  }

  incrementOutputSeq(terminalId: string): number {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return 0;
    }
    terminal.last_output_seq += 1;
    return terminal.last_output_seq;
  }

  remove(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return;
    }
    this.terminals.delete(terminalId);
    const sessionSet = this.terminalsBySession.get(terminal.session_id);
    if (!sessionSet) {
      return;
    }
    sessionSet.delete(terminalId);
    if (sessionSet.size === 0) {
      this.terminalsBySession.delete(terminal.session_id);
    }
  }

  removeBySession(sessionId: string): void {
    const terminalIds = this.terminalsBySession.get(sessionId);
    if (!terminalIds) {
      return;
    }
    for (const terminalId of terminalIds) {
      this.terminals.delete(terminalId);
    }
    this.terminalsBySession.delete(sessionId);
  }

  isOwnedBy(terminalId: string, context: ExpectedContext): boolean {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return false;
    }
    return (
      terminal.workspace_id === context.workspace_id &&
      terminal.lane_id === context.lane_id &&
      terminal.session_id === context.session_id
    );
  }
}
