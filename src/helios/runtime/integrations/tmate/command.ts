import { execCommand } from "../exec";
import type { TmateAdapter } from "./adapter";

export class TmateCommandAdapter implements TmateAdapter {
  async startShare(terminalId: string): Promise<{ sshCommand: string; webUrl?: string }> {
    const result = await execCommand("tmate", [
      "-S",
      `/tmp/${terminalId}.sock`,
      "new-session",
      "-d",
    ]);
    if (result.code !== 0) throw new Error(`tmate start share failed: ${result.stderr}`);

    const sshInfo = await execCommand("tmate", [
      "-S",
      `/tmp/${terminalId}.sock`,
      "display",
      "-p",
      "#tmate_ssh",
    ]);
    const webInfo = await execCommand("tmate", [
      "-S",
      `/tmp/${terminalId}.sock`,
      "display",
      "-p",
      "#tmate_web",
    ]);

    return {
      sshCommand: sshInfo.stdout.trim(),
      webUrl: webInfo.code === 0 ? webInfo.stdout.trim() : undefined,
    };
  }

  async stopShare(terminalId: string): Promise<void> {
    const result = await execCommand("tmate", ["-S", `/tmp/${terminalId}.sock`, "kill-server"]);
    if (result.code !== 0) throw new Error(`tmate stop share failed: ${result.stderr}`);
  }
}
