// T003 - Stale zellij session detector

import { execCommand } from "../../integrations/exec.js";
import type { OrphanedResource } from "./resource_classifier.js";

export interface SessionRegistry {
  getSession(sessionId: string): { laneId?: string } | null;
  getSessions(): Array<{ id: string; laneId?: string }>;
}

export class ZellijDetector {
  constructor(private readonly sessionRegistry: SessionRegistry) {}

  async detect(): Promise<OrphanedResource[]> {
    const orphans: OrphanedResource[] = [];

    try {
      const sessions = await this.listZellijSessions();

      for (const session of sessions) {
        const sessionId = this.extractSessionId(session.name);
        if (!sessionId) {
          // Can't extract session ID, skip
          continue;
        }

        // Check if session is bound in registry
        const registered = this.sessionRegistry.getSession(sessionId);
        if (registered) {
          // Check if owning lane is recovering
          if (registered.laneId) {
            // If we can check lane state, skip recovering lanes
            continue;
          }
          // Session is still registered
          continue;
        }

        // No registered session found - this is stale
        orphans.push({
          type: "zellij_session",
          path: session.name,
          createdAt: new Date(session.created).toISOString(),
          estimatedOwnerId: sessionId,
          metadata: {
            sessionName: session.name,
          },
        });
      }
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: Zellij CLI failure should remain observable for operators.
      console.warn(`Zellij session detection failed: ${String(error)}`);
    }

    return orphans;
  }

  private async listZellijSessions(): Promise<Array<{ name: string; created: number }>> {
    try {
      // Use zellij CLI to list sessions
      const result = await execCommand("zellij", ["list-sessions", "-n"]);
      if (result.code !== 0) {
        console.warn("zellij list-sessions failed:", result.stderr);
        return [];
      }

      const sessions = result.stdout
        .split("\n")
        .filter(line => line.trim())
        .map(line => {
          return {
            name: line.trim(),
            created: Date.now(), // Default: assume recent if we can't determine
          };
        });
      return sessions;
    } catch (error) {
      console.error("Failed to list zellij sessions:", error);
      return [];
    }
  }

  private extractSessionId(sessionName: string): string | null {
    // Session names are typically in format like "session-abc123"
    const match = sessionName.match(/^(session-[a-z0-9]+|session-[a-z0-9]+)$/i);
    return match ? match[1] : sessionName; // Treat whole name as ID if no pattern
  }
}
