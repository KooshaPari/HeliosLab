import { spawn } from "bun";
import { randomUUID } from "crypto";
import path from "path";

export interface TerminalSession {
  id: string;
  process: any;
  cwd: string;
  shell: string;
  ready: boolean;
  currentCwd?: string; // Track the current working directory
  inputBuffer: string; // Buffer for collecting input until Enter
  stdoutReader?: ReadableStreamDefaultReader<Uint8Array>;
  stderrReader?: ReadableStreamDefaultReader<Uint8Array>;
}

interface PtyMessage {
  type: 'spawn' | 'input' | 'resize' | 'shutdown' | 'get_cwd';
  spawn?: {
    shell: string;
    cwd: string;
    cols: number;
    rows: number;
  };
  input?: {
    data: string;
  };
  resize?: {
    cols: number;
    rows: number;
  };
}

interface PtyResponse {
  type: 'ready' | 'data' | 'error' | 'cwd_update';
  data?: string;
  error_msg?: string;
}

// Plugin command handler type
type PluginCommandChecker = (commandLine: string) => string | null;
type PluginCommandExecutor = (
  commandLine: string,
  terminalId: string,
  cwd: string,
  write: (text: string) => void
) => Promise<boolean>;

// Built-in command handler type (for edit command, etc.)
type BuiltinCommandHandler = (
  args: string[],
  terminalId: string,
  cwd: string,
  write: (text: string) => void
) => Promise<boolean>;

class TerminalManager {
  private terminals: Map<string, TerminalSession> = new Map();
  private terminalToWindow: Map<string, string> = new Map(); // terminalId -> windowId
  private windowHandlers: Map<string, (message: any) => void> = new Map(); // windowId -> handler
  private pluginCommandChecker?: PluginCommandChecker;
  private pluginCommandExecutor?: PluginCommandExecutor;
  private editCommandHandler?: BuiltinCommandHandler;

  /**
   * @deprecated Use setWindowMessageHandler instead for proper multi-window support
   */
  setMessageHandler(handler: (message: any) => void) {
    // Legacy support - register as "default" window
    this.windowHandlers.set("default", handler);
  }

  setWindowMessageHandler(windowId: string, handler: (message: any) => void) {
    this.windowHandlers.set(windowId, handler);
  }

  removeWindowMessageHandler(windowId: string) {
    this.windowHandlers.delete(windowId);
    // Kill all terminals owned by this window
    for (const [terminalId, ownerWindowId] of this.terminalToWindow.entries()) {
      if (ownerWindowId === windowId) {
        this.killTerminal(terminalId);
      }
    }
  }

  private getMessageHandler(terminalId: string): ((message: any) => void) | undefined {
    const windowId = this.terminalToWindow.get(terminalId);
    if (windowId) {
      return this.windowHandlers.get(windowId);
    }
    // Fallback to default handler for legacy support
    return this.windowHandlers.get("default");
  }

  /**
   * Set the plugin command handlers for intercepting terminal input
   */
  setPluginCommandHandlers(
    checker: PluginCommandChecker,
    executor: PluginCommandExecutor
  ) {
    this.pluginCommandChecker = checker;
    this.pluginCommandExecutor = executor;
  }

  /**
   * Set the handler for the built-in 'edit' command
   */
  setEditCommandHandler(handler: BuiltinCommandHandler) {
    this.editCommandHandler = handler;
  }

  /**
   * Check if a command line is the built-in 'edit' command
   * Returns the file path argument if it matches, null otherwise
   */
  private checkEditCommand(commandLine: string): string[] | null {
    const trimmed = commandLine.trim();
    // Match 'edit <path>' or 'colab <path>'
    const editMatch = trimmed.match(/^edit\s+(.+)$/);
    const colabMatch = trimmed.match(/^colab\s+(.+)$/);

    if (editMatch) {
      // Parse arguments (handle quoted paths, multiple files, etc.)
      return this.parseEditArgs(editMatch[1]);
    }
    if (colabMatch) {
      return this.parseEditArgs(colabMatch[1]);
    }
    return null;
  }

  /**
   * Parse edit command arguments, handling quoted paths
   */
  private parseEditArgs(argsString: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const char of argsString) {
      if (!inQuote && (char === '"' || char === "'")) {
        inQuote = true;
        quoteChar = char;
      } else if (inQuote && char === quoteChar) {
        inQuote = false;
        quoteChar = '';
      } else if (!inQuote && char === ' ') {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    if (current) {
      args.push(current);
    }
    return args;
  }

  createTerminal(cwd: string = process.cwd(), shell?: string, cols: number = 80, rows: number = 24, windowId?: string): string {
    const terminalId = randomUUID();

    // Determine shell
    const defaultShell = process.platform === "win32" ? "cmd.exe" :
                        process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
    const terminalShell = shell || process.env.SHELL || defaultShell;

    // console.log(`Creating PTY terminal ${terminalId} with shell: ${terminalShell}, cwd: ${cwd}, windowId: ${windowId}`);

    // Path to the Zig PTY binary - in the MacOS directory alongside the main executable
    const ptyBinaryPath = path.join(process.cwd(), "colab-pty");

    const proc = spawn([ptyBinaryPath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: process.cwd(),
      // @ts-ignore - Bun specific option
      allowUnsafeCustomBinary: true,
    });

    const terminal: TerminalSession = {
      id: terminalId,
      process: proc,
      cwd,
      shell: terminalShell,
      ready: false,
      currentCwd: cwd, // Initialize with the starting directory
      inputBuffer: '', // Buffer for plugin command detection
    };

    // Track which window owns this terminal
    if (windowId) {
      this.terminalToWindow.set(terminalId, windowId);
    }

    // Handle PTY output
    this.readPtyOutput(proc, terminalId);

    // Handle process exit
    proc.exited.then((exitCode) => {
      // console.log(`PTY process ${terminalId} exited with code ${exitCode}`);
      const terminal = this.terminals.get(terminalId);
      if (terminal) {
        this.cleanupReaders(terminal);
      }
      const handler = this.getMessageHandler(terminalId);
      handler?.({
        type: "terminalExit",
        terminalId,
        exitCode,
        signal: 0,
      });
      this.terminals.delete(terminalId);
      this.terminalToWindow.delete(terminalId);
    });

    this.terminals.set(terminalId, terminal);

    // Send spawn message to PTY binary
    this.sendPtyMessage(terminalId, {
      type: 'spawn',
      spawn: {
        shell: terminalShell,
        cwd: cwd,
        cols: cols,
        rows: rows,
      }
    });

    return terminalId;
  }

  private sendPtyMessage(terminalId: string, message: PtyMessage) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    try {
      const jsonMessage = JSON.stringify(message) + '\n';
      terminal.process.stdin.write(jsonMessage);
    } catch (error) {
      console.error("Error sending PTY message:", error);
    }
  }

  private async readPtyOutput(proc: any, terminalId: string) {
    try {
      const stdoutReader = proc.stdout.getReader();
      const stderrReader = proc.stderr.getReader();

      // Store readers on terminal session for cleanup
      const terminal = this.terminals.get(terminalId);
      if (terminal) {
        terminal.stdoutReader = stdoutReader;
        terminal.stderrReader = stderrReader;
      }

      // Read stdout (JSON messages from PTY binary)
      (async () => {
        try {
          let buffer = '';
          while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;

            const text = new TextDecoder().decode(value);
            buffer += text;

            // Process complete JSON lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const response: PtyResponse = JSON.parse(line);
                  this.handlePtyResponse(terminalId, response);
                } catch (error) {
                  console.error("Error parsing PTY response:", error, line);
                }
              }
            }
          }
        } catch (error) {
          // Ignore errors when reader is cancelled during cleanup
          if (!(error instanceof Error && error.name === 'AbortError')) {
            console.error("Error reading PTY stdout:", error);
          }
        }
      })();

      // Read stderr (PTY binary errors)
      (async () => {
        try {
          while (true) {
            const { done, value } = await stderrReader.read();
            if (done) break;

            const text = new TextDecoder().decode(value);
            console.error(`PTY ${terminalId} stderr:`, text);
          }
        } catch (error) {
          // Ignore errors when reader is cancelled during cleanup
          if (!(error instanceof Error && error.name === 'AbortError')) {
            console.error("Error reading PTY stderr:", error);
          }
        }
      })();

    } catch (error) {
      console.error("Error setting up PTY output readers:", error);
    }
  }

  private cleanupReaders(terminal: TerminalSession) {
    try {
      terminal.stdoutReader?.cancel();
    } catch (e) {
      // Already closed or cancelled
    }
    try {
      terminal.stderrReader?.cancel();
    } catch (e) {
      // Already closed or cancelled
    }
  }

  private handlePtyResponse(terminalId: string, response: PtyResponse) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    const messageHandler = this.getMessageHandler(terminalId);
    // console.log(`PTY ${terminalId} response:`, response);

    switch (response.type) {
      case 'ready':
        terminal.ready = true;
        // console.log(`PTY terminal ${terminalId} is ready`);
        break;

      case 'data':
        if (response.data) {
          messageHandler?.({
            type: "terminalOutput",
            terminalId,
            data: response.data,
          });
        }
        break;

      case 'cwd_update':
        if (response.data) {
          // Update the stored current working directory
          terminal.currentCwd = response.data;
        }
        break;

      case 'error':
        console.error(`PTY error for ${terminalId}:`, response.error_msg);
        messageHandler?.({
          type: "terminalOutput",
          terminalId,
          data: `Error: ${response.error_msg}\r\n`,
        });
        break;
    }
  }

  writeToTerminal(terminalId: string, data: string): boolean {
    // console.log(`Writing to PTY terminal ${terminalId}:`, JSON.stringify(data));
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      console.log("Terminal not found:", { terminal: !!terminal });
      return false;
    }

    if (!terminal.ready) {
      console.log("Terminal not ready yet");
      return false;
    }

    try {
      // Filter dangerous control characters from pasted content (multi-character input)
      // Single character input is preserved to allow intentional Ctrl+D for EOF to running programs
      // But pasted content should never contain EOF (\x04) as it can accidentally close the shell
      if (data.length > 1) {
        // Remove \x04 (Ctrl+D/EOF) from pasted content to prevent accidental shell exit
        data = data.replace(/\x04/g, '');
        // If filtering removed all content, nothing to send
        if (data.length === 0) {
          return true;
        }
      }
      const messageHandler = this.getMessageHandler(terminalId);

      // Check for built-in and plugin command interception
      // Handle special characters
      if (data === '\r' || data === '\n') {
        // Enter pressed - check if buffer matches a built-in or plugin command
        const commandLine = terminal.inputBuffer.trim();

        // Check for built-in 'edit' command first
        const editArgs = this.checkEditCommand(commandLine);
        if (editArgs && editArgs.length > 0 && this.editCommandHandler) {
          // Clear the buffer
          terminal.inputBuffer = '';

          // Echo newline to terminal
          messageHandler?.({
            type: "terminalOutput",
            terminalId,
            data: '\r\n',
          });

          // Execute edit command
          const write = (text: string) => {
            messageHandler?.({
              type: "terminalOutput",
              terminalId,
              data: text,
            });
          };

          const cwd = terminal.currentCwd || terminal.cwd;
          this.editCommandHandler(editArgs, terminalId, cwd, write).then(() => {
            // Show a new prompt after command completes
            this.sendPtyMessage(terminalId, {
              type: 'input',
              input: { data: '' }
            });
          });

          return true;
        }

        // Check for plugin command
        if (this.pluginCommandChecker && this.pluginCommandExecutor) {
          const pluginCommand = this.pluginCommandChecker(commandLine);

          if (pluginCommand) {
            // Clear the buffer
            terminal.inputBuffer = '';

            // Echo newline to terminal
            messageHandler?.({
              type: "terminalOutput",
              terminalId,
              data: '\r\n',
            });

            // Execute plugin command and stream output
            const write = (text: string) => {
              messageHandler?.({
                type: "terminalOutput",
                terminalId,
                data: text,
              });
            };

            const cwd = terminal.currentCwd || terminal.cwd;
            this.pluginCommandExecutor(commandLine, terminalId, cwd, write).then(() => {
              // Show a new prompt after command completes
              // Send empty input to trigger shell prompt
              this.sendPtyMessage(terminalId, {
                type: 'input',
                input: { data: '' }
              });
            });

            return true;
          }
        }

        // Not a built-in or plugin command, clear buffer and send to PTY
        terminal.inputBuffer = '';
      } else if (data === '\x7f' || data === '\b') {
        // Backspace - remove last char from buffer
        terminal.inputBuffer = terminal.inputBuffer.slice(0, -1);
      } else if (data === '\x03') {
        // Ctrl+C - clear buffer
        terminal.inputBuffer = '';
      } else if (data === '\x15') {
        // Ctrl+U - clear line/buffer
        terminal.inputBuffer = '';
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        // Regular printable character - add to buffer
        terminal.inputBuffer += data;
      }

      // Send input to PTY binary, chunking large inputs to avoid buffer overflow
      // The Zig PTY binary has an 8192 byte buffer. We chunk at 2048 to be safe
      // because JSON escaping can significantly increase size (e.g., \n -> \\n, \x1b -> \\u001b)
      const MAX_CHUNK_SIZE = 2048;

      if (data.length <= MAX_CHUNK_SIZE) {
        // Small input, send directly
        this.sendPtyMessage(terminalId, {
          type: 'input',
          input: {
            data: data
          }
        });
      } else {
        // Large input (paste), chunk it to avoid StreamTooLong error
        for (let i = 0; i < data.length; i += MAX_CHUNK_SIZE) {
          const chunk = data.slice(i, i + MAX_CHUNK_SIZE);
          this.sendPtyMessage(terminalId, {
            type: 'input',
            input: {
              data: chunk
            }
          });
        }
      }

      return true;
    } catch (error) {
      console.error("Error writing to PTY terminal:", error);
      return false;
    }
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): boolean {
    // console.log(`Resizing PTY terminal ${terminalId}: ${cols}x${rows}`);
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return false;
    
    try {
      this.sendPtyMessage(terminalId, {
        type: 'resize',
        resize: {
          cols: cols,
          rows: rows
        }
      });
      return true;
    } catch (error) {
      console.error("Error resizing PTY terminal:", error);
      return false;
    }
  }

  killTerminal(terminalId: string): boolean {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return false;
    }

    try {
      // Cancel stream readers first to stop the read loops
      this.cleanupReaders(terminal);

      // Send shutdown message to PTY binary
      this.sendPtyMessage(terminalId, {
        type: 'shutdown'
      });

      // Give PTY time to cleanup, then kill the process
      setTimeout(() => {
        try {
          terminal.process.kill();
        } catch (error) {
          console.error("Error killing PTY process:", error);
        }
      }, 100);

      this.terminals.delete(terminalId);
      this.terminalToWindow.delete(terminalId);
      return true;
    } catch (error) {
      console.error("Error killing terminal:", error);
      return false;
    }
  }

  getTerminal(terminalId: string): TerminalSession | undefined {
    return this.terminals.get(terminalId);
  }

  getAllTerminals(): TerminalSession[] {
    return Array.from(this.terminals.values());
  }

  cleanup() {
    for (const terminal of this.terminals.values()) {
      try {
        // Cancel stream readers first to stop the read loops
        this.cleanupReaders(terminal);

        // Send shutdown message to each PTY
        this.sendPtyMessage(terminal.id, {
          type: 'shutdown'
        });

        // Kill the process after a short delay
        setTimeout(() => {
          try {
            terminal.process.kill();
          } catch (error) {
            console.error("Error killing PTY process during cleanup:", error);
          }
        }, 100);
      } catch (error) {
        console.error("Error during cleanup:", error);
      }
    }
    this.terminals.clear();
  }

  async getTerminalCwd(terminalId: string): Promise<string | null> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return null;
    }

    // Send a get_cwd message to the PTY binary to get the current directory
    try {
      this.sendPtyMessage(terminalId, { type: 'get_cwd' });

      // Wait a bit for the response
      await new Promise(resolve => setTimeout(resolve, 100));

      // Return the current tracked CWD
      return terminal.currentCwd || terminal.cwd;
    } catch (error) {
      console.error(`Error getting CWD for terminal ${terminalId}:`, error);
      return terminal.cwd;
    }
  }
}

export const terminalManager = new TerminalManager();