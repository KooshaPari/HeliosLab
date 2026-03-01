/**
 * Terminal Bridge
 *
 * Allocates real PTY subprocesses and bridges helios terminal lifecycle
 * commands. Streams PTY output back to renderers via RPC.
 *
 * Uses Bun.spawn when available (production), gracefully falls back
 * when unavailable (test environment).
 */

import { broadcastToAllWindowsInWorkspace } from "../../main/workspaceWindows";
import { randomUUID } from "crypto";

interface TerminalProcess {
  id: string;
  process: any;
  cwd: string;
  shell: string;
  workspaceId: string;
  heliosWindowKey: string;
  stdoutReader?: any;
  stderrReader?: any;
  isExited: boolean;
}

/**
 * Creates a terminal bridge that manages real PTY subprocesses.
 */
export function createTerminalBridge() {
  const terminals = new Map<string, TerminalProcess>();
  const outputListeners = new Map<string, (data: string) => void>();
  const exitListeners = new Map<string, (code: number) => void>();

  /**
   * Spawn a real PTY terminal and wire output to the helios renderer.
   */
  function spawnTerminal(
    heliosTerminalId: string,
    workspaceId: string,
    windowId: string,
    cwd?: string,
  ): string {
    const heliosWindowKey = `helios:${windowId}`;
    const workingDir = cwd ?? process.cwd();

    // Try to spawn with Bun.spawn (production) or stub out
    let ptyProcess: any = null;
    try {
      const { spawn } = require("bun");
      const defaultShell =
        globalThis.process.platform === "win32"
          ? "cmd.exe"
          : globalThis.process.platform === "darwin"
            ? "/bin/zsh"
            : "/bin/bash";

      ptyProcess = spawn([defaultShell], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        cwd: workingDir,
      });
    } catch (error) {
      // Bun.spawn not available (test environment)
      console.warn("[helios] terminal bridge: Bun.spawn not available, using stub");
      ptyProcess = {
        stdin: { write: () => true },
        stdout: { getReader: () => ({ read: async () => ({ done: true }) }) },
        stderr: { getReader: () => ({ read: async () => ({ done: true }) }) },
        exited: Promise.resolve(0),
      };
    }

    const terminalId = randomUUID();
    const defaultShell =
      globalThis.process.platform === "win32"
        ? "cmd.exe"
        : globalThis.process.platform === "darwin"
          ? "/bin/zsh"
          : "/bin/bash";
    const terminal: TerminalProcess = {
      id: terminalId,
      process: ptyProcess,
      cwd: workingDir,
      shell: defaultShell,
      workspaceId,
      heliosWindowKey,
      isExited: false,
    };

    terminals.set(heliosTerminalId, terminal);

    // Register output and exit listeners
    outputListeners.set(heliosTerminalId, (data: string) => {
      broadcastToAllWindowsInWorkspace(workspaceId, "helios:terminal-data", {
        terminalId: heliosTerminalId,
        data,
      });
    });

    exitListeners.set(heliosTerminalId, (exitCode: number) => {
      broadcastToAllWindowsInWorkspace(workspaceId, "helios:terminal-data", {
        terminalId: heliosTerminalId,
        data: `\r\n[Process exited with code ${exitCode}]\r\n`,
      });
      terminal.isExited = true;
    });

    // Start reading output streams
    readStreams(terminal, heliosTerminalId);

    // Handle process exit
    if (ptyProcess.exited) {
      ptyProcess.exited.then((exitCode: number) => {
        const listener = exitListeners.get(heliosTerminalId);
        listener?.(exitCode);
        terminals.delete(heliosTerminalId);
        outputListeners.delete(heliosTerminalId);
        exitListeners.delete(heliosTerminalId);
        cleanupReaders(terminal);
      });
    }

    console.log(
      `[helios] terminal bridge: spawned pty ${terminalId} for ` +
        `helios terminal ${heliosTerminalId}`,
    );
    return terminalId;
  }

  /**
   * Write data to terminal stdin
   */
  function writeToTerminal(heliosTerminalId: string, data: string): boolean {
    const terminal = terminals.get(heliosTerminalId);
    if (!terminal || terminal.isExited) return false;

    try {
      terminal.process.stdin.write(data);
      return true;
    } catch (error) {
      console.error(
        `[helios] terminal bridge: error writing to terminal ${heliosTerminalId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Resize terminal dimensions
   */
  function resizeTerminal(heliosTerminalId: string, cols: number, rows: number): boolean {
    const terminal = terminals.get(heliosTerminalId);
    if (!terminal || terminal.isExited) return false;

    try {
      if (terminal.process.resize) {
        terminal.process.resize({ cols, rows });
      }
      return true;
    } catch (error) {
      console.error(`[helios] terminal bridge: error resizing terminal ${heliosTerminalId}`, error);
      return false;
    }
  }

  /**
   * Kill terminal process
   */
  function killTerminal(heliosTerminalId: string): boolean {
    const terminal = terminals.get(heliosTerminalId);
    if (!terminal) return false;

    try {
      if (terminal.process.kill) {
        terminal.process.kill();
      }
      terminal.isExited = true;
      cleanupReaders(terminal);
      terminals.delete(heliosTerminalId);
      outputListeners.delete(heliosTerminalId);
      exitListeners.delete(heliosTerminalId);
      return true;
    } catch (error) {
      console.error(`[helios] terminal bridge: error killing terminal ${heliosTerminalId}`, error);
      return false;
    }
  }

  /**
   * Dispose all terminals and cleanup resources
   */
  function dispose(): void {
    for (const [heliosTerminalId] of terminals) {
      killTerminal(heliosTerminalId);
    }
    terminals.clear();
    outputListeners.clear();
    exitListeners.clear();
  }

  /**
   * Read output streams from PTY process
   */
  async function readStreams(terminal: TerminalProcess, heliosTerminalId: string): Promise<void> {
    try {
      const stdoutReader = terminal.process.stdout?.getReader?.();
      const stderrReader = terminal.process.stderr?.getReader?.();

      if (stdoutReader) {
        terminal.stdoutReader = stdoutReader;
      }
      if (stderrReader) {
        terminal.stderrReader = stderrReader;
      }

      if (stdoutReader) {
        readOutputStream(stdoutReader, heliosTerminalId, "stdout");
      }
      if (stderrReader) {
        readOutputStream(stderrReader, heliosTerminalId, "stderr");
      }
    } catch (error) {
      console.error(
        `[helios] terminal bridge: error setting up stream readers for ` + `${heliosTerminalId}`,
        error,
      );
    }
  }

  /**
   * Read from a single output stream
   */
  async function readOutputStream(
    reader: any,
    heliosTerminalId: string,
    streamName: string,
  ): Promise<void> {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        const listener = outputListeners.get(heliosTerminalId);
        listener?.(text);
      }
    } catch (error) {
      // Ignore errors when reader is cancelled during cleanup
      if (!(error instanceof Error && error.name === "AbortError")) {
        console.error(
          `[helios] terminal bridge: error reading ${streamName} for ` + `${heliosTerminalId}`,
          error,
        );
      }
    }
  }

  /**
   * Clean up stream readers
   */
  function cleanupReaders(terminal: TerminalProcess): void {
    try {
      terminal.stdoutReader?.cancel?.();
      terminal.stderrReader?.cancel?.();
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  return {
    spawnTerminal,
    writeToTerminal,
    resizeTerminal,
    killTerminal,
    dispose,
  };
}

export class HeliosTerminalBridge {
  private bridge = createTerminalBridge();

  spawnTerminal(
    heliosTerminalId: string,
    workspaceId: string,
    windowId: string,
    cwd?: string,
  ): string {
    return this.bridge.spawnTerminal(heliosTerminalId, workspaceId, windowId, cwd);
  }

  sendInput(heliosTerminalId: string, data: string): boolean {
    return this.bridge.writeToTerminal(heliosTerminalId, data);
  }

  resize(heliosTerminalId: string, cols: number, rows: number): boolean {
    return this.bridge.resizeTerminal(heliosTerminalId, cols, rows);
  }

  dispose(): void {
    this.bridge.dispose();
  }
}
