export type BufferedOutput = {
  seq: number;
  chunk: string;
  ts: string;
};

export type TerminalBufferSnapshot = {
  terminal_id: string;
  total_bytes: number;
  cap_bytes: number;
  dropped_bytes: number;
  entries: BufferedOutput[];
};

type TerminalBufferState = {
  totalBytes: number;
  droppedBytes: number;
  entries: BufferedOutput[];
};

type PushResult = {
  entry: BufferedOutput;
  overflowed: boolean;
  droppedBytes: number;
};

export class TerminalOutputBuffer {
  private readonly stateByTerminal = new Map<string, TerminalBufferState>();

  constructor(private readonly capBytes: number) {}

  push(terminalId: string, entry: BufferedOutput): PushResult {
    let state = this.stateByTerminal.get(terminalId);
    if (!state) {
      state = { totalBytes: 0, droppedBytes: 0, entries: [] };
      this.stateByTerminal.set(terminalId, state);
    }

    const entryBytes = this.byteLength(entry.chunk);
    state.entries.push(entry);
    state.totalBytes += entryBytes;

    let overflowed = false;
    let droppedBytes = 0;
    while (state.totalBytes > this.capBytes && state.entries.length > 0) {
      overflowed = true;
      const dropped = state.entries.shift();
      if (!dropped) {
        break;
      }
      const removedBytes = this.byteLength(dropped.chunk);
      state.totalBytes -= removedBytes;
      state.droppedBytes += removedBytes;
      droppedBytes += removedBytes;
    }

    return { entry, overflowed, droppedBytes };
  }

  get(terminalId: string): TerminalBufferSnapshot {
    const state = this.stateByTerminal.get(terminalId);
    if (!state) {
      return {
        terminal_id: terminalId,
        total_bytes: 0,
        cap_bytes: this.capBytes,
        dropped_bytes: 0,
        entries: [],
      };
    }
    return {
      terminal_id: terminalId,
      total_bytes: state.totalBytes,
      cap_bytes: this.capBytes,
      dropped_bytes: state.droppedBytes,
      entries: [...state.entries],
    };
  }

  clear(terminalId: string): void {
    this.stateByTerminal.delete(terminalId);
  }

  private byteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
  }
}
