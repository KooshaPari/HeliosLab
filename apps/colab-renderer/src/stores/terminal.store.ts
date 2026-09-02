import { createSignal } from "solid-js";

export type TerminalInfo = {
  id: string;
  name: string;
};

const [terminals, setTerminals] = createSignal<TerminalInfo[]>([]);
const [activeTerminalId, setActiveTerminalId] = createSignal<string | null>(null);

let nextId = 1;

export function createTerminal(): string {
  const id = `term-${nextId++}`;
  const name = `Terminal ${nextId - 1}`;
  setTerminals((prev: TerminalInfo[]) => [...prev, { id, name }]);
  setActiveTerminalId(id);
  return id;
}

export function closeTerminal(id: string): void {
  setTerminals((prev: TerminalInfo[]) => prev.filter(t => t.id !== id));
  const remaining = terminals();
  if (activeTerminalId() === id) {
    setActiveTerminalId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
  }
}

export function switchTerminal(id: string): void {
  setActiveTerminalId(id);
}

export function getTerminals() {
  return terminals();
}

export function getActiveTerminalId() {
  return activeTerminalId();
}

// Stub for terminal write - will be wired to PTY bridge later
export function writeToTerminal(terminalId: string, data: string): void {
  // TODO: Wire to ElectroBun RPC terminal.write
  console.log(`[terminal ${terminalId}] write: ${data}`);
}
