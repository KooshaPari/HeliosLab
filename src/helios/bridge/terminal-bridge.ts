/**
 * Terminal Bridge
 *
 * Bridges helios terminal lifecycle commands to co(lab)'s pty-based
 * terminalManager. Streams pty output back to renderers via RPC.
 */

import { terminalManager } from "../../main/utils/terminalManager";
import { broadcastToAllWindowsInWorkspace } from "../../main/workspaceWindows";

export class HeliosTerminalBridge {
  private readonly heliosTerminals = new Map<string, { realTerminalId: string; workspaceId: string; heliosWindowKey: string }>();

  /**
   * Spawn a real pty terminal and wire output to the helios renderer.
   */
  spawnTerminal(heliosTerminalId: string, workspaceId: string, windowId: string, cwd?: string): string {
    // Use a helios-specific windowId so terminalManager.getMessageHandler
    // resolves to our handler (it looks up terminalToWindow[id] → windowId
    // → windowHandlers[windowId]). Using the real windowId would clobber
    // the ivde terminal handler already registered on that key.
    const heliosWindowKey = `helios:${windowId}`;

    const realId = terminalManager.createTerminal(
      cwd ?? process.cwd(),
      undefined, // default shell
      80,
      24,
      heliosWindowKey,
    );

    this.heliosTerminals.set(heliosTerminalId, { realTerminalId: realId, workspaceId, heliosWindowKey });

    // Register handler under the same key that terminalManager will look up
    terminalManager.setWindowMessageHandler(heliosWindowKey, (message: any) => {
      if (message.type === "terminalOutput" && message.data) {
        broadcastToAllWindowsInWorkspace(workspaceId, "helios:terminal-data", {
          terminalId: heliosTerminalId,
          data: message.data,
        });
      }
      if (message.type === "terminalExit") {
        broadcastToAllWindowsInWorkspace(workspaceId, "helios:terminal-data", {
          terminalId: heliosTerminalId,
          data: `\r\n[Process exited with code ${message.exitCode}]\r\n`,
        });
        this.heliosTerminals.delete(heliosTerminalId);
      }
    });

    console.log(`[helios] terminal bridge: spawned pty ${realId} for helios terminal ${heliosTerminalId}`);
    return realId;
  }

  sendInput(heliosTerminalId: string, data: string): boolean {
    const entry = this.heliosTerminals.get(heliosTerminalId);
    if (!entry) return false;
    return terminalManager.writeToTerminal(entry.realTerminalId, data);
  }

  resize(heliosTerminalId: string, cols: number, rows: number): boolean {
    const entry = this.heliosTerminals.get(heliosTerminalId);
    if (!entry) return false;
    return terminalManager.resizeTerminal(entry.realTerminalId, cols, rows);
  }

  dispose(): void {
    for (const [, entry] of this.heliosTerminals) {
      terminalManager.killTerminal(entry.realTerminalId);
      terminalManager.removeWindowMessageHandler(entry.heliosWindowKey);
    }
    this.heliosTerminals.clear();
  }
}
