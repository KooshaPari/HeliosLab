import { execCommand } from "../exec";
import type { UptermAdapter } from "./adapter";

export class UptermCommandAdapter implements UptermAdapter {
  async startShare(terminalId: string): Promise<{ shareUrl: string }> {
    const result = await execCommand("upterm", ["host", "--session", terminalId]);
    if (result.code !== 0) throw new Error(`upterm start share failed: ${result.stderr}`);
    return { shareUrl: result.stdout.trim() };
  }

  async stopShare(terminalId: string): Promise<void> {
    const result = await execCommand("upterm", ["stop", "--session", terminalId]);
    if (result.code !== 0) throw new Error(`upterm stop share failed: ${result.stderr}`);
  }
}
