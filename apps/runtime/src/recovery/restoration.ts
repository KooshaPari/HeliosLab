import type { LocalBus } from "../protocol/bus.js";
import type { Checkpoint, CheckpointSession } from "./checkpoint.js";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";

export interface RestoredSession {
  sessionId: string;
  terminalId: string;
  laneId: string;
  zellijSessionName?: string;
  status: "reattached" | "respawned";
}

export interface FailedSession {
  sessionId: string;
  terminalId: string;
  laneId: string;
  reason: string;
  suggestion?: string;
}

export interface RestorationResult {
  restored: RestoredSession[];
  failed: FailedSession[];
  duration: number;
}

export class RestorationPipeline {
  private bus?: LocalBus;
  private zellijListCache?: string[];

  constructor(bus?: LocalBus) {
    this.bus = bus;
  }

  async restore(checkpoint: Checkpoint): Promise<RestorationResult> {
    const _startTime = Date.now();
    const restored: RestoredSession[] = [];
    const failed: FailedSession[] = [];

    try {
      // Stage 1: Zellij session reattach
      const survivingZelijjSessions = await this.getSurvivingZelijjSessions();

      for (const session of checkpoint.sessions) {
        const matching = this.findMatchingZelijjSession(
          session.zelijjSessionName,
          survivingZelijjSessions
        );

        if (matching) {
          // Reattach surviving session
          try {
            await this.reattachZelijjSession(session, matching);
            const restored_session: RestoredSession = {
              sessionId: session.sessionId,
              terminalId: session.terminalId,
              laneId: session.laneId,
              zellijSessionName: matching,
              status: "reattached",
            };
            restored.push(restored_session);
            await this.publishSessionRestored(restored_session);
          } catch {
            // Fall through to respawn attempt
            await this.attemptRespawn(session, restored, failed);
          }
        } else {
          // Respawn new session
          await this.attemptRespawn(session, restored, failed);
        }
      }

      // Stage 2: Par lane re-inventory (no-op for now, reserved for future)

      // Stage 3: PTY re-spawn is handled in attemptRespawn

      const _duration = Date.now() - startTime;
      return { restored, failed, duration };
    } catch {
      const _duration = Date.now() - startTime;
      console.error("Restoration pipeline failed:", err);
      return {
        restored,
        failed: [
          ...failed,
          ...checkpoint.sessions
            .filter(
              s =>
                !restored.some(r => r.sessionId === s.sessionId) &&
                !failed.some(f => f.sessionId === s.sessionId)
            )
            .map(s => ({
              sessionId: s.sessionId,
              terminalId: s.terminalId,
              laneId: s.laneId,
              reason: "Restoration pipeline error",
            })),
        ],
        duration,
      };
    }
  }

  private async getSurvivingZelijjSessions(): Promise<string[]> {
    if (this.zellijListCache) {
      return this.zellijListCache;
    }

    try {
      // In a real implementation, this would call zellij list-sessions
      // For now, return empty to allow respawn path
      return [];
    } catch {
      return [];
    }
  }

  private findMatchingZelijjSession(
    sessionName: string,
    survivingSessions: string[]
  ): string | undefined {
    return survivingSessions.find(s => s === sessionName);
  }

  private async reattachZelijjSession(
    session: CheckpointSession,
    zellijSessionName: string
  ): Promise<void> {
    // In a real implementation, this would use zellij IPC to reattach
    // For now, we just verify the session exists
    if (!zellijSessionName) {
      throw new Error("Zellij session name is empty");
    }
  }

  private async attemptRespawn(
    session: CheckpointSession,
    restored: RestoredSession[],
    failed: FailedSession[]
  ): Promise<void> {
    try {
      // Verify working directory exists
      await fs.access(session.workingDirectory);

      // In a real implementation, spawn shell and create zellij session
      // For now, just mark as respawned
      const newZelijjSessionName = `restored-${session.sessionId}`;

      const restored_session: RestoredSession = {
        sessionId: session.sessionId,
        terminalId: session.terminalId,
        laneId: session.laneId,
        zellijSessionName: newZelijjSessionName,
        status: "respawned",
      };

      restored.push(restored_session);
      await this.publishSessionRestored(restored_session);
    } catch {
      const reason = err instanceof Error ? err.message : String(err);
      const failedSession: FailedSession = {
        sessionId: session.sessionId,
        terminalId: session.terminalId,
        laneId: session.laneId,
        reason,
        suggestion:
          reason.includes("ENOENT") || reason.includes("no such file")
            ? "Directory no longer exists. Check if it was deleted."
            : "Could not restore session. Check logs for details.",
      };
      failed.push(failedSession);
      await this.publishSessionFailed(failedSession);
    }
  }

  private async publishSessionRestored(session: RestoredSession): Promise<void> {
    if (!this.bus) return;

    await this.bus.publish({
      id: randomUUID(),
      type: "event",
      ts: new Date().toISOString(),
      topic: "recovery.session.restored",
      payload: {
        sessionId: session.sessionId,
        status: session.status,
        zellijSessionName: session.zellijSessionName,
      },
    });
  }

  private async publishSessionFailed(session: FailedSession): Promise<void> {
    if (!this.bus) return;

    await this.bus.publish({
      id: randomUUID(),
      type: "event",
      ts: new Date().toISOString(),
      topic: "recovery.session.failed",
      payload: {
        sessionId: session.sessionId,
        reason: session.reason,
        suggestion: session.suggestion,
      },
    });
  }
}
