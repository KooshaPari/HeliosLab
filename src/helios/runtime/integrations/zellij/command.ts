import { execCommand } from "../exec";
import type { ZellijAdapter } from "./adapter";

export class ZellijCommandAdapter implements ZellijAdapter {
  async ensureSession(sessionName: string): Promise<void> {
    const result = await execCommand("zellij", ["--session", sessionName, "action", "new-pane"]);
    if (result.code !== 0) throw new Error(`zellij ensure session failed: ${result.stderr}`);
  }

  async openPane(sessionName: string, command: string): Promise<void> {
    const result = await execCommand("zellij", [
      "--session",
      sessionName,
      "action",
      "new-pane",
      "--",
      "sh",
      "-lc",
      command,
    ]);
    if (result.code !== 0) throw new Error(`zellij open pane failed: ${result.stderr}`);
  }

  async killSession(sessionName: string): Promise<void> {
    const result = await execCommand("zellij", ["delete-session", sessionName, "--force"]);
    if (result.code !== 0) throw new Error(`zellij kill session failed: ${result.stderr}`);
  }
}
