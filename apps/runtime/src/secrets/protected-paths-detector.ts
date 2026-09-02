import { randomBytes } from "node:crypto";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import { ProtectedPathConfig } from "./protected-paths-config.js";
import {
  extractFilePaths,
  matchesPattern,
  redactCommandForAudit,
} from "./protected-paths-matching.js";
import type { ProtectedPathAcknowledgment, ProtectedPathMatch } from "./protected-paths-types.js";

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

  async check(
    command: string,
    opts?: { terminalId?: string; correlationId?: string }
  ): Promise<ProtectedPathMatch[]> {
    const filePaths = extractFilePaths(command);
    if (filePaths.length === 0) return [];

    const matches = this._findMatches(command, filePaths);
    for (const match of matches) {
      await this._emit("secrets.protected_path.accessed", {
        patternId: match.patternId,
        pattern: match.pattern,
        matchedPath: match.matchedPath,
        command: match.command,
        terminalId: opts?.terminalId ?? null,
        correlationId: opts?.correlationId ?? randomBytes(8).toString("hex"),
      });
    }

    for (const match of matches) {
      for (const callback of this.warningCallbacks) {
        callback(match);
      }
    }

    return matches;
  }

  private _findMatches(command: string, filePaths: string[]): ProtectedPathMatch[] {
    const patterns = this.config.getEnabledPatterns();
    const seen = new Set<string>();
    return filePaths.flatMap(filePath => this._matchFilePath(command, filePath, patterns, seen));
  }

  private _matchFilePath(
    command: string,
    filePath: string,
    patterns: ReturnType<ProtectedPathConfig["getEnabledPatterns"]>,
    seen: Set<string>
  ): ProtectedPathMatch[] {
    const matches: ProtectedPathMatch[] = [];
    for (const pattern of patterns) {
      if (!matchesPattern(filePath, pattern.pattern)) continue;
      const dedupeKey = `${pattern.id}:${filePath}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (this._isDebounced(pattern.id, filePath)) continue;

      matches.push({
        patternId: pattern.id,
        pattern: pattern.pattern,
        matchedPath: filePath,
        warningMessage: `Command accesses protected path '${filePath}' matching pattern '${pattern.description}'`,
        command: redactCommandForAudit(command),
      });
    }
    return matches;
  }

  onWarning(callback: (match: ProtectedPathMatch) => void): void {
    this.warningCallbacks.push(callback);
  }

  async acknowledge(patternId: string, matchedPath: string, correlationId?: string): Promise<void> {
    const key = `${patternId}:${matchedPath}`;
    const acknowledgedAt = Date.now();
    await this._emit("secrets.protected_path.acknowledged", {
      patternId,
      matchedPath,
      correlationId: correlationId ?? null,
      acknowledgedAt: new Date(acknowledgedAt).toISOString(),
    });
    this.acknowledgments.set(key, {
      patternId,
      matchedPath,
      acknowledgedAt,
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
