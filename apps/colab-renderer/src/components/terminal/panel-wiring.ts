/**
 * The panel's wiring, extracted so it can be tested.
 *
 * `TerminalPanel.tsx` cannot be render-tested in this repo: Bun's transpiler
 * compiles JSX with React's transform because the root tsconfig sets
 * `"jsx": "preserve"`, and changing that config to suit a test would affect the
 * whole app build. So the part that carries the logic - which callback goes
 * where - lives here, takes its dependencies as arguments, and needs no DOM.
 *
 * What is left in the component is DOM glue: constructing the xterm instance and
 * registering a ResizeObserver. Both are typechecked; neither is where the bugs
 * were.
 */

/** The subset of the xterm Terminal this wiring needs. */
export interface TerminalLike {
  readonly cols: number;
  readonly rows: number;
  write(chunk: Uint8Array): void;
  onData(handler: (data: string) => void): { dispose(): void };
}

/** The store functions the wiring calls. Passed in rather than imported, so a
 *  test can supply its own and assert on them. */
export interface TerminalWiringDeps {
  subscribeToTerminal(
    terminalId: string,
    listener: (chunk: Uint8Array) => void,
  ): () => void;
  writeToTerminal(terminalId: string, data: string): void;
  resizeTerminal(terminalId: string, cols: number, rows: number): void;
}

/**
 * Connect a terminal to its shell in both directions.
 *
 * Returns a dispose function. Callers must call it: the data subscription is a
 * long-lived registration in the store, and leaving one behind leaks the
 * terminal and keeps delivering output to a disposed xterm instance.
 */
export function wireTerminal(
  terminalId: string,
  terminal: TerminalLike,
  deps: TerminalWiringDeps,
): { dispose: () => void } {
  // Output: shell -> xterm.
  const unsubscribe = deps.subscribeToTerminal(terminalId, (chunk) => {
    terminal.write(chunk);
  });

  // Input: xterm -> shell.
  const input = terminal.onData((data) => {
    deps.writeToTerminal(terminalId, data);
  });

  return {
    dispose: () => {
      unsubscribe();
      input.dispose();
    },
  };
}

/**
 * Tell the shell its window size changed.
 *
 * Separate from `fit()`, which only changes what xterm renders. Without this a
 * full-screen program keeps drawing at the old dimensions.
 *
 * Reads cols/rows off the terminal rather than taking them as arguments, so the
 * caller cannot report a stale size it captured earlier.
 */
export function reportTerminalSize(
  terminalId: string,
  terminal: TerminalLike,
  deps: TerminalWiringDeps,
): void {
  deps.resizeTerminal(terminalId, terminal.cols, terminal.rows);
}  
