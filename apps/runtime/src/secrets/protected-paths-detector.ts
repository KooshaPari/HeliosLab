import { randomBytes } from "node:crypto";
import type { LocalBus } from "../protocol/bus.js";
import type { ProtectedPathAcknowledgment, ProtectedPathMatch } from "./protected-paths-types.js";
import { ProtectedPathConfig } from "./protected-paths-config.js";
import {
  extractFilePaths,
  matchesPattern,
  redactCommandForAudit,
} from "./protected-paths-matching.js";
import type { LocalBusEnvelope } from "../protocol/types.js";

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

export class ProtectedPathDetector {
  private config: ProtectedPathConfig;
  private bus: LocalBus | null;
  private warningCallbacks: Array<(match: ProtectedPathMatch) => void> = [];
  private acknowledgments: Map<string, ProtectedPathAcknowledgment> = new Map();

  constructor(opts?: { config?: ProtectedPathConfig; bus?: LocalBus }) {
    this.config = opts?.config ?? new ProtectedPathConfig();
    this.bus = opts?.bus ?? null;
  }

  getConfig(): ProtectedPathConfig {
    return this.config;
  }

  check(
    command: string,
    opts?: { terminalId?: string; correlationId?: string }
  ): ProtectedPathMatch[] {
    const filePaths = extractFilePaths(command);
    if (filePaths.length === 0) return [];

    const enabledPatterns = this.config.getEnabledPatterns();
    const matches: ProtectedPathMatch[] = [];
    const seen = new Set<string>();

    for (const filePath of filePaths) {
      for (const pattern of enabledPatterns) {
        if (matchesPattern(filePath, pattern.pattern)) {
          const dedupeKey = `${pattern.id}:${filePath}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          if (this._isDebounced(pattern.id, filePath)) continue;

          const redactedCommand = redactCommandForAudit(command);

          const match: ProtectedPathMatch = {
            patternId: pattern.id,
            pattern: pattern.pattern,
            matchedPath: filePath,
            warningMessage:
              "Command accesses protected path '" +
              `${filePath}` +
              "' matching pattern '" +
              `${pattern.description}` +
              "'",
            command: redactedCommand,
          };
          matches.push(match);

          void this._emit("secrets.protected_path.accessed", {
            patternId: pattern.id,
            pattern: pattern.pattern,
            matchedPath: filePath,
            command: redactedCommand,
            terminalId: opts?.terminalId ?? null,
            correlationId: opts?.correlationId ?? randomBytes(8).toString("hex"),
          });

          for (const cb of this.warningCallbacks) {
            cb(match);
          }
        }
      }
    }

    return matches;
  }

  onWarning(callback: (match: ProtectedPathMatch) => void): void {
    this.warningCallbacks.push(callback);
  }

  acknowledge(patternId: string, matchedPath: string, correlationId?: string): void {
    const key = `${patternId}:${matchedPath}`;
    this.acknowledgments.set(key, {
      patternId,
      matchedPath,
      acknowledgedAt: Date.now(),
    });

    void this._emit("secrets.protected_path.acknowledged", {
      patternId,
      matchedPath,
      correlationId: correlationId ?? null,
      acknowledgedAt: new Date().toISOString(),
    });
  }

  private _isDebounced(patternId: string, matchedPath: string): boolean {
    const key = `${patternId}:${matchedPath}`;
    const ack = this.acknowledgments.get(key);
    if (!ack) return false;
    return Date.now() - ack.acknowledgedAt < DEBOUNCE_MS;
  }

  private async _emit(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.bus) return;
    const envelope: LocalBusEnvelope = {
      id: `protected-paths:${topic}:${Date.now()}:${randomBytes(4).toString("hex")}`,
      type: "event",
      ts: new Date().toISOString(),
      topic,
      payload,
    };
    await this.bus.publish(envelope);
  }
}
