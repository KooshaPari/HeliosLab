// T004 - Leaked PTY process detector

import { execCommand } from "../../integrations/exec.js";
import type { OrphanedResource } from "./resource_classifier.js";

export interface TerminalRegistry {
  getTerminal(terminalId: string): { laneId?: string } | null;
  getTerminals(): Array<{ id: string; laneId?: string }>;
}

export class PtyDetector {
  private readonly gracePeriodMs = 5000; // 5 second grace period for recently spawned processes

  constructor(private readonly terminalRegistry: TerminalRegistry) {}

  async detect(): Promise<OrphanedResource[]> {
    const orphans: OrphanedResource[] = [];

    try {
      const ptyProcesses = await this.listPtyProcesses();

      for (const proc of ptyProcesses) {
        // Skip recently spawned processes (grace period)
        const ageMs = Date.now() - proc.startTime;
        if (ageMs < this.gracePeriodMs) {
          continue;
        }

        // Check if this PTY is bound in terminal registry
        const registered = this.terminalRegistry.getTerminal(proc.pty);
        if (registered) {
          // PTY is registered, not leaked
          continue;
        }

        // Filter out system PTY processes not owned by Helios
        if (this.isSystemProcess(proc)) {
          continue;
        }

        // No terminal binding found - this is leaked
        orphans.push({
          type: "pty_process",
          pid: proc.pid,
          createdAt: new Date(proc.startTime).toISOString(),
          estimatedOwnerId: proc.pty, // Use PTY device as best-effort identifier
          metadata: {
            ptyDevice: proc.pty,
            command: proc.command,
          },
        });
      }
    } catch {
      // biome-ignore lint/suspicious/noConsole: PTY detection failures are intentionally logged for operational diagnostics.
      console.warn(`PTY leak detection failed: ${String(error)}`);
    }

    return orphans;
  }

  private async listPtyProcesses(): Promise<
    Array<{ pid: number; pty: string; startTime: number; command: string }>
  > {
    try {
      // Use ps to list processes with PTY
      const result = await execCommand("ps", ["-ef", "-o", "pid,tty,etime,comm"]);

      if (result.code !== 0) {
        console.warn("ps command failed:", result.stderr);
        return [];
      }

      const processes: Array<{
        pid: number;
        pty: string;
        startTime: number;
        command: string;
      }> = [];

      const lines = result.stdout.split("\n").slice(1); // Skip header
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;

        const pid = parseInt(parts[0], 10);
        const tty = parts[1];
        const command = parts.slice(3).join(" ");

        // Skip processes not attached to a TTY (?, pts/X, tty/X patterns)
        if (!tty || tty === "?" || tty === "??") {
          continue;
        }

        // Parse etime (elapsed time) to estimate start time
        const startTime = this.parseElapsedTime(parts[2]);

        processes.push({
          pid,
          pty: tty,
          startTime,
          command,
        });
      }

      return processes;
    } catch {
      // biome-ignore lint/suspicious/noConsole: PTY process enumeration is best-effort and should remain observable.
      console.warn(`Failed to list PTY processes: ${String(error)}`);
      return [];
    }
  }

  private parseElapsedTime(etimeStr: string): number {
    // etime format: [[DD-]HH:]MM:SS
    // Convert to milliseconds from now
    try {
      const parts = etimeStr.split(":").reverse();
      let seconds = 0;
      if (parts.length >= 1) seconds += parseInt(parts[0], 10);
      if (parts.length >= 2) seconds += parseInt(parts[1], 10) * 60;
      if (parts.length >= 3) {
        const hourOrDay = parts[2];
        if (hourOrDay.includes("-")) {
          const [day, hour] = hourOrDay.split("-").map(x => parseInt(x, 10));
          seconds += (day * 24 + hour) * 3600;
        } else {
          seconds += parseInt(hourOrDay, 10) * 3600;
        }
      }

      // Return the start time as milliseconds since epoch (approximately)
      return Date.now() - seconds * 1000;
    } catch {
      return Date.now(); // Default to now if parse fails
    }
  }

  private isSystemProcess(proc: { pid: number; command: string }): boolean {
    // Filter out common system processes that typically have PTY
    const systemPatterns = [
      /^(kernel_task|launchd|sshd|bash|sh|zsh|tmux|screen)/i,
      /^\/usr\/libexec\//,
    ];

    return systemPatterns.some(pattern => pattern.test(proc.command));
  }
}
