import { execCommand } from "../exec";
import type { UptermAdapter } from "./adapter";

const UPTERM_INSTALL_MESSAGE = `upterm CLI is not installed. Install it using one of these methods:

1. Using Homebrew (macOS/Linux):
   brew install upterm

2. Using the install script (Linux/macOS):
   curl -sL https://github.com/owenthereal/upterm/raw/main/scripts/install.sh | bash

3. Visit https://github.com/owenthereal/upterm for more installation options.

Once installed, upterm will allow you to share terminal sessions securely.`;

async function checkUptermAvailable(): Promise<boolean> {
  try {
    const result = await execCommand("which", ["upterm"]);
    return result.code === 0;
  } catch {
    return false;
  }
}

const processMap = new Map<string, number>();

export class UptermCommandAdapter implements UptermAdapter {
  async startShare(terminalId: string): Promise<{ shareUrl: string }> {
    const available = await checkUptermAvailable();
    if (!available) {
      throw new Error(UPTERM_INSTALL_MESSAGE);
    }

    // Run upterm host in background and capture the session link
    // Using 'bash -c' to wrap the command so it runs in background properly
    const result = await execCommand("bash", ["-c", `upterm host -- bash 2>&1 | head -1`]);

    if (result.code !== 0) {
      throw new Error(`upterm start share failed: ${result.stderr || result.stdout}`);
    }

    const shareUrl = result.stdout.trim();
    if (!shareUrl) {
      throw new Error("upterm host command did not return a share URL");
    }

    // Extract PID from process and store for cleanup
    try {
      const pidResult = await execCommand("pgrep", ["-f", "upterm host"]);
      if (pidResult.code === 0) {
        const pid = parseInt(pidResult.stdout.trim().split("\n")[0], 10);
        if (!isNaN(pid)) {
          processMap.set(terminalId, pid);
        }
      }
    } catch {
      // If we can't get PID, continue anyway - stopShare will handle it
    }

    return { shareUrl };
  }

  async stopShare(terminalId: string): Promise<void> {
    const pid = processMap.get(terminalId);

    if (pid) {
      try {
        await execCommand("kill", [String(pid)]);
        processMap.delete(terminalId);
      } catch {
        // Process may already be terminated
        processMap.delete(terminalId);
      }
    } else {
      // Fallback: try to kill any upterm process associated with this terminal
      try {
        const result = await execCommand("pkill", ["-f", `upterm.*${terminalId}`]);
        if (result.code !== 0) {
          // This is not necessarily an error - the process might already be gone
        }
      } catch {
        // Graceful degradation - process cleanup attempted
      }
    }
  }
}
