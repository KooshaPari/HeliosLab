// T007-T009 - Remediation engine with confirmation gates and recovery suppression

import { promises as fs } from "fs";
import { execCommand } from "../../integrations/exec.js";
import path from "path";
import os from "os";
import { type ClassifiedOrphan, type ResourceType } from "./resource_classifier.js";
import type { LocalBus } from "../../protocol/bus.js";
import type { LaneRegistry } from "../registry.js";

export interface RemediationSuggestion {
  id: string;
  resource: ClassifiedOrphan;
  suggestedAction: string;
  requiresConfirmation: boolean;
  createdAt: string;
}

export interface CleanupResult {
  resourceId: string;
  success: boolean;
  message: string;
  resourceType: ResourceType;
}

interface CooldownEntry {
  resourceKey: string;
  expiresAt: number; // milliseconds since epoch
}

export class RemediationEngine {
  private suggestions = new Map<string, RemediationSuggestion>();
  private cooldownMap = new Map<string, CooldownEntry>();
  private readonly cooldownDurationMs = 24 * 60 * 60 * 1000; // 24 hours
  private readonly cooldownPath = path.join(
    os.homedir(),
    ".helios",
    "data",
    "remediation_cooldown.json"
  );

  constructor(
    private readonly laneRegistry: LaneRegistry,
    private readonly bus: LocalBus
  ) {
    this.loadCooldownMap();
  }

  async generateSuggestions(orphans: ClassifiedOrphan[]): Promise<RemediationSuggestion[]> {
    const suggestions: RemediationSuggestion[] = [];

    // Expire old cooldown entries
    this.expireCooldownEntries();

    for (const orphan of orphans) {
      // Check if resource is in cooldown
      const resourceKey = this.getResourceKey(orphan);
      if (this.cooldownMap.has(resourceKey)) {
        continue; // Skip resources in cooldown
      }

      // Check if owning lane is recovering
      if (orphan.estimatedOwner !== "unknown") {
        try {
          const lane = this.laneRegistry.get(orphan.estimatedOwner);
          if (lane && (lane.state as string) === "recovering") {
            // Suppress suggestion for recovering lanes
            continue;
          }
        } catch {
          // Lane not found or error - proceed with suggestion
        }
      }

      const suggestion: RemediationSuggestion = {
        id: `suggestion-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        resource: orphan,
        suggestedAction: this.getSuggestedAction(orphan),
        requiresConfirmation: true,
        createdAt: new Date().toISOString(),
      };

      suggestions.push(suggestion);
      this.suggestions.set(suggestion.id, suggestion);

      // Emit suggestion event
      await this.bus.publish({
        id: `remediation-suggested-${suggestion.id}`,
        type: "event",
        ts: new Date().toISOString(),
        topic: "orphan.remediation.suggested",
        payload: {
          suggestionId: suggestion.id,
          resourceType: orphan.type,
          resourcePath: orphan.path || orphan.pid,
          riskLevel: orphan.riskLevel,
          estimatedOwner: orphan.estimatedOwner,
        },
      });
    }

    return suggestions;
  }

  getSuggestions(): RemediationSuggestion[] {
    const RISK_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return Array.from(this.suggestions.values()).sort(
      (a, b) => RISK_ORDER[b.resource.riskLevel] - RISK_ORDER[a.resource.riskLevel]
    );
  }

  async confirmCleanup(suggestionId: string): Promise<CleanupResult> {
    const suggestion = this.suggestions.get(suggestionId);
    if (!suggestion) {
      return {
        resourceId: suggestionId,
        success: false,
        message: "Suggestion not found",
        resourceType: "worktree",
      };
    }

    // Emit confirmation event
    await this.bus.publish({
      id: `remediation-confirmed-${suggestionId}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "orphan.remediation.confirmed",
      payload: {
        suggestionId,
        resourceType: suggestion.resource.type,
        resourcePath: suggestion.resource.path || suggestion.resource.pid,
      },
    });

    // Execute cleanup based on resource type
    const result = await this.executeCleanup(suggestion.resource);

    // Remove suggestion after cleanup
    this.suggestions.delete(suggestionId);

    // Emit completion event
    await this.bus.publish({
      id: `remediation-completed-${suggestionId}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "orphan.remediation.completed",
      payload: {
        suggestionId,
        ...result,
      },
    });

    return result;
  }

  async declineCleanup(suggestionId: string): Promise<void> {
    const suggestion = this.suggestions.get(suggestionId);
    if (!suggestion) {
      return;
    }

    // Add resource to cooldown
    const resourceKey = this.getResourceKey(suggestion.resource);
    this.cooldownMap.set(resourceKey, {
      resourceKey,
      expiresAt: Date.now() + this.cooldownDurationMs,
    });

    // Persist cooldown
    this.saveCooldownMap();

    // Remove suggestion
    this.suggestions.delete(suggestionId);

    // Emit declined event
    await this.bus.publish({
      id: `remediation-declined-${suggestionId}`,
      type: "event",
      ts: new Date().toISOString(),
      topic: "orphan.remediation.declined",
      payload: {
        suggestionId,
        resourcePath: suggestion.resource.path || suggestion.resource.pid,
        cooldownUntil: new Date(Date.now() + this.cooldownDurationMs).toISOString(),
      },
    });
  }

  private async executeCleanup(orphan: ClassifiedOrphan): Promise<CleanupResult> {
    try {
      switch (orphan.type) {
        case "worktree":
          return await this.cleanupWorktree(orphan);
        case "zellij_session":
          return await this.cleanupZellijSession(orphan);
        case "pty_process":
          return await this.cleanupPtyProcess(orphan);
        default:
          return {
            resourceId: orphan.path || String(orphan.pid),
            success: false,
            message: `Unknown resource type: ${orphan.type}`,
            resourceType: orphan.type,
          };
      }
    } catch (error) {
      return {
        resourceId: orphan.path || String(orphan.pid),
        success: false,
        message: `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        resourceType: orphan.type,
      };
    }
  }

  private async cleanupWorktree(orphan: ClassifiedOrphan): Promise<CleanupResult> {
    if (!orphan.path) {
      return {
        resourceId: "unknown",
        success: false,
        message: "Worktree path not available",
        resourceType: "worktree",
      };
    }

    try {
      // Take snapshot before deletion
      await this.snapshotWorktree(orphan);

      // Remove worktree using git
      const result = await execCommand("git", ["worktree", "remove", orphan.path]);

      if (result.code === 0) {
        return {
          resourceId: orphan.path,
          success: true,
          message: "Worktree removed successfully",
          resourceType: "worktree",
        };
      } else {
        return {
          resourceId: orphan.path,
          success: false,
          message: `git worktree remove failed: ${result.stderr}`,
          resourceType: "worktree",
        };
      }
    } catch (error) {
      return {
        resourceId: orphan.path,
        success: false,
        message: `Worktree cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        resourceType: "worktree",
      };
    }
  }

  private async snapshotWorktree(orphan: ClassifiedOrphan): Promise<void> {
    if (!orphan.path) return;

    const snapshotDir = path.join(os.homedir(), ".helios", "data", "worktree_snapshots");
    await fs.mkdir(snapshotDir, { recursive: true });

    const snapshotName = `${Date.now()}-${orphan.estimatedOwner}.json`;
    const snapshotPath = path.join(snapshotDir, snapshotName);

    const snapshot = {
      timestamp: new Date().toISOString(),
      path: orphan.path,
      estimatedOwner: orphan.estimatedOwner,
      metadata: orphan.metadata,
      age: orphan.age,
    };

    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
  }

  private async cleanupZellijSession(orphan: ClassifiedOrphan): Promise<CleanupResult> {
    if (!orphan.path) {
      return {
        resourceId: "unknown",
        success: false,
        message: "Session name not available",
        resourceType: "zellij_session",
      };
    }

    try {
      const result = await execCommand("zellij", ["kill-session", orphan.path]);

      if (result.code === 0) {
        return {
          resourceId: orphan.path,
          success: true,
          message: "Zellij session terminated",
          resourceType: "zellij_session",
        };
      } else {
        return {
          resourceId: orphan.path,
          success: false,
          message: `zellij kill-session failed: ${result.stderr}`,
          resourceType: "zellij_session",
        };
      }
    } catch (error) {
      return {
        resourceId: orphan.path,
        success: false,
        message: `Session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        resourceType: "zellij_session",
      };
    }
  }

  private async cleanupPtyProcess(orphan: ClassifiedOrphan): Promise<CleanupResult> {
    if (!orphan.pid) {
      return {
        resourceId: String(orphan.pid),
        success: false,
        message: "Process PID not available",
        resourceType: "pty_process",
      };
    }

    try {
      // Send SIGTERM
      const killResult = await execCommand("kill", ["-TERM", String(orphan.pid)]);

      if (killResult.code === 0 || killResult.code === 1) {
        // Wait up to 5 seconds for graceful exit
        await this.sleep(1000);

        // Check if process still exists
        const checkResult = await execCommand("kill", ["-0", String(orphan.pid)]);

        if (checkResult.code !== 0) {
          // Process already terminated
          return {
            resourceId: String(orphan.pid),
            success: true,
            message: "Process terminated gracefully",
            resourceType: "pty_process",
          };
        }

        // Still alive, send SIGKILL
        const killResult2 = await execCommand("kill", ["-KILL", String(orphan.pid)]);

        if (killResult2.code === 0 || killResult2.code === 1) {
          return {
            resourceId: String(orphan.pid),
            success: true,
            message: "Process killed forcefully",
            resourceType: "pty_process",
          };
        } else {
          return {
            resourceId: String(orphan.pid),
            success: false,
            message: "Failed to terminate process",
            resourceType: "pty_process",
          };
        }
      } else {
        return {
          resourceId: String(orphan.pid),
          success: false,
          message: "SIGTERM failed",
          resourceType: "pty_process",
        };
      }
    } catch (error) {
      return {
        resourceId: String(orphan.pid),
        success: false,
        message: `Process cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        resourceType: "pty_process",
      };
    }
  }

  private getSuggestedAction(orphan: ClassifiedOrphan): string {
    switch (orphan.type) {
      case "worktree":
        return `Delete orphaned worktree at ${orphan.path}`;
      case "zellij_session":
        return `Terminate stale zellij session: ${orphan.path}`;
      case "pty_process":
        return `Terminate leaked PTY process (PID ${orphan.pid})`;
      default:
        return "Unknown cleanup action";
    }
  }

  private getResourceKey(orphan: ClassifiedOrphan): string {
    if (orphan.path) {
      return `${orphan.type}:${orphan.path}`;
    } else if (orphan.pid) {
      return `${orphan.type}:${orphan.pid}`;
    } else {
      return `${orphan.type}:unknown`;
    }
  }

  private expireCooldownEntries(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cooldownMap.entries()) {
      if (entry.expiresAt <= now) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cooldownMap.delete(key);
    }

    if (expiredKeys.length > 0) {
      this.saveCooldownMap();
    }
  }

  private async loadCooldownMap(): Promise<void> {
    try {
      const content = await fs.readFile(this.cooldownPath, "utf-8");
      const entries = JSON.parse(content) as CooldownEntry[];
      for (const entry of entries) {
        this.cooldownMap.set(entry.resourceKey, entry);
      }
      // Expire old entries
      this.expireCooldownEntries();
    } catch {
      // File doesn't exist or is corrupt - start fresh
    }
  }

  /** Clear in-memory state (called between tests). Does NOT persist. */
  stop(): void {
    this.cooldownMap.clear();
    this.suggestions.clear();
  }

  private saveCooldownMap(): void {
    try {
      const dir = path.dirname(this.cooldownPath);
      fs.mkdir(dir, { recursive: true }).then(() => {
        const entries = Array.from(this.cooldownMap.values());
        fs.writeFile(this.cooldownPath, JSON.stringify(entries, null, 2));
      });
    } catch (error) {
      console.error("Failed to save cooldown map:", error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
