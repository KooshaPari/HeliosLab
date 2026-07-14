import { execCommand } from "../exec";
import type { ZmxAdapter } from "./adapter";

export class ZmxCommandAdapter implements ZmxAdapter {
  async checkpoint(sessionId: string): Promise<string> {
    const result = await execCommand("zmx", ["checkpoint", "--session", sessionId]);
    if (result.code !== 0) throw new Error(`zmx checkpoint failed: ${result.stderr}`);
    return result.stdout.trim();
  }

  async restore(checkpointId: string): Promise<void> {
    const result = await execCommand("zmx", ["restore", "--checkpoint", checkpointId]);
    if (result.code !== 0) throw new Error(`zmx restore failed: ${result.stderr}`);
  }
}
