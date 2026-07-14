import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import type { RedactionRule } from "./redaction-engine.js";

export type { RedactionRule };

// ---------------------------------------------------------------------------
// Default rules
// ---------------------------------------------------------------------------

export function getDefaultRules(): RedactionRule[] {
  return [
    {
      id: "aws-access-key",
      category: "AWS_ACCESS_KEY",
      pattern: /AKIA[0-9A-Z]{16}/,
      description: "AWS Access Key ID",
      enabled: true,
      falsePositiveRate: 0.001,
    },
    {
      id: "aws-secret-key",
      category: "AWS_SECRET_KEY",
      // 40-char base64 after aws_secret context
      pattern:
        /(?:aws_secret(?:_access_key)?|AWS_SECRET(?:_ACCESS_KEY)?)\s*[=:]\s*["']?([A-Za-z0-9+/]{40})["']?/,
      description: "AWS Secret Access Key",
      enabled: true,
      falsePositiveRate: 0.001,
    },
    {
      id: "gcp-api-key",
      category: "GCP_API_KEY",
      pattern: /AIza[0-9A-Za-z\-_]{35}/,
      description: "GCP API Key",
      enabled: true,
      falsePositiveRate: 0.001,
    },
    {
      id: "github-token",
      category: "GITHUB_TOKEN",
      pattern: /gh[ps]_[A-Za-z0-9_]{36,}/,
      description: "GitHub Personal Access Token (ghs_/ghp_)",
      enabled: true,
      falsePositiveRate: 0.001,
    },
    {
      id: "github-pat",
      category: "GITHUB_TOKEN",
      pattern: /github_pat_[A-Za-z0-9_]{82,}/,
      description: "GitHub Fine-grained Personal Access Token",
      enabled: true,
      falsePositiveRate: 0.001,
    },
    {
      id: "openai-key",
      category: "OPENAI_KEY",
      pattern: /sk-[A-Za-z0-9]{48,}/,
      description: "OpenAI API Key",
      enabled: true,
      falsePositiveRate: 0.001,
    },
    {
      id: "bearer-token",
      category: "BEARER_TOKEN",
      pattern: /Bearer [A-Za-z0-9\-._~+/]+=*/,
      description: "HTTP Bearer Token",
      enabled: true,
      falsePositiveRate: 0.01,
    },
    {
      id: "generic-api-key",
      category: "API_KEY",
      pattern: /(?:api_key|apikey|api_token)\s*[=:]\s*["']?([A-Za-z0-9\-_]{16,})["']?/i,
      description: "Generic API key pattern",
      enabled: true,
      falsePositiveRate: 0.05,
    },
    {
      id: "connection-string",
      category: "CONNECTION_STRING",
      pattern: /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s"']+/i,
      description: "Database connection string with credentials",
      enabled: true,
      falsePositiveRate: 0.001,
    },
    {
      id: "private-key",
      category: "PRIVATE_KEY",
      pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
      description: "PEM private key header",
      enabled: true,
      falsePositiveRate: 0.001,
    },
  ];
}

// ---------------------------------------------------------------------------
// RedactionRuleManager
// ---------------------------------------------------------------------------

export class RedactionRuleManager {
  private rules: Map<string, RedactionRule & { matchCount: number }> = new Map();
  private bus: LocalBus | null;

  constructor(opts?: { bus?: LocalBus; initialRules?: RedactionRule[] }) {
    this.bus = opts?.bus ?? null;
    const initial = opts?.initialRules ?? getDefaultRules();
    for (const rule of initial) {
      this.rules.set(rule.id, { ...rule, matchCount: 0 });
    }
  }

  addRule(rule: RedactionRule): void {
    if (!rule.id || rule.id.trim() === "") {
      throw new Error("Rule id must not be empty");
    }
    if (!rule.pattern || rule.pattern.source === "(?:)") {
      throw new Error("Rule pattern must not be empty");
    }
    // Validate regex by attempting construction
    try {
      new RegExp(rule.pattern.source, rule.pattern.flags);
    } catch (e) {
      throw new Error(`Invalid regex pattern: ${(e as Error).message}`);
    }
    this.rules.set(rule.id, { ...rule, matchCount: 0 });
    void this._emit("secrets.redaction.rules.changed", {
      action: "add",
      ruleId: rule.id,
    });
  }

  removeRule(id: string): void {
    if (!this.rules.has(id)) {
      throw new Error(`Rule '${id}' not found`);
    }
    this.rules.delete(id);
    void this._emit("secrets.redaction.rules.changed", {
      action: "remove",
      ruleId: id,
    });
  }

  enableRule(id: string): void {
    const rule = this._getRule(id);
    rule.enabled = true;
    void this._emit("secrets.redaction.rules.changed", {
      action: "enable",
      ruleId: id,
    });
  }

  disableRule(id: string): void {
    const rule = this._getRule(id);
    rule.enabled = false;
    void this._emit("secrets.redaction.rules.changed", {
      action: "disable",
      ruleId: id,
    });
  }

  listRules(): RedactionRule[] {
    return Array.from(this.rules.values()).map(({ matchCount: _mc, ...rule }) => rule);
  }

  incrementMatchCount(id: string): void {
    const rule = this.rules.get(id);
    if (rule) rule.matchCount++;
  }

  getMatchCount(id: string): number {
    return this.rules.get(id)?.matchCount ?? 0;
  }

  importRules(filePath: string): void {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Array<{
      id: string;
      category: string;
      pattern: string;
      flags?: string;
      description: string;
      enabled: boolean;
      falsePositiveRate?: number;
    }>;

    for (const entry of parsed) {
      if (!entry.id || !entry.pattern) {
        throw new Error(`Invalid rule entry: missing id or pattern`);
      }
      const rule: RedactionRule = {
        id: entry.id,
        category: entry.category,
        pattern: new RegExp(entry.pattern, entry.flags ?? ""),
        description: entry.description,
        enabled: entry.enabled,
        falsePositiveRate: entry.falsePositiveRate,
      };
      this.rules.set(rule.id, { ...rule, matchCount: 0 });
    }
    void this._emit("secrets.redaction.rules.changed", {
      action: "import",
      count: parsed.length,
    });
  }

  exportRules(filePath: string): void {
    const data = Array.from(this.rules.values()).map(({ matchCount: _mc, pattern, ...rest }) => ({
      ...rest,
      pattern: pattern.source,
      flags: pattern.flags,
    }));
    writeFileSync(filePath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
    });
  }

  private _getRule(id: string): RedactionRule & { matchCount: number } {
    const rule = this.rules.get(id);
    if (!rule) throw new Error(`Rule '${id}' not found`);
    return rule;
  }

  private async _emit(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.bus) return;
    const envelope: LocalBusEnvelope = {
      id: `redaction-rules:${topic}:${Date.now()}:${randomBytes(4).toString("hex")}`,
      type: "event",
      ts: new Date().toISOString(),
      topic,
      payload,
    };
    await this.bus.publish(envelope);
  }
}
