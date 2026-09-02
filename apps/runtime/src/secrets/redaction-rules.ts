import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import { assertRedactionPatternConsumesInput, type RedactionRule } from "./redaction-engine.js";

export type { RedactionRule };

function validateRule(rule: unknown): RedactionRule {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    throw new Error("Invalid redaction rule: expected an object");
  }

  const candidate = rule as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    throw new Error("Invalid redaction rule: id must be non-empty");
  }
  if (typeof candidate.category !== "string" || candidate.category.trim() === "") {
    throw new Error(`Invalid redaction rule '${candidate.id}': category must be non-empty`);
  }
  if (!(candidate.pattern instanceof RegExp)) {
    throw new Error(`Invalid redaction rule '${candidate.id}': pattern must be non-empty`);
  }
  assertRedactionPatternConsumesInput(candidate.pattern);
  if (typeof candidate.description !== "string") {
    throw new Error(`Invalid redaction rule '${candidate.id}': description must be a string`);
  }
  if (typeof candidate.enabled !== "boolean") {
    throw new Error(`Invalid redaction rule '${candidate.id}': enabled must be a boolean`);
  }
  if (
    candidate.falsePositiveRate !== undefined &&
    (typeof candidate.falsePositiveRate !== "number" ||
      !Number.isFinite(candidate.falsePositiveRate) ||
      candidate.falsePositiveRate < 0 ||
      candidate.falsePositiveRate > 1)
  ) {
    throw new Error(
      `Invalid redaction rule '${candidate.id}': falsePositiveRate must be between 0 and 1`
    );
  }

  return {
    id: candidate.id,
    category: candidate.category,
    pattern: new RegExp(candidate.pattern.source, candidate.pattern.flags),
    description: candidate.description,
    enabled: candidate.enabled,
    falsePositiveRate: candidate.falsePositiveRate as number | undefined,
  };
}

function parsePersistedRule(value: unknown): RedactionRule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid persisted redaction rule: expected an object");
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.pattern !== "string") {
    throw new Error("Invalid persisted redaction rule: pattern must be a string");
  }
  if (candidate.flags !== undefined && typeof candidate.flags !== "string") {
    throw new Error("Invalid persisted redaction rule: flags must be a string");
  }

  let pattern: RegExp;
  try {
    pattern = new RegExp(candidate.pattern, candidate.flags ?? "");
  } catch (error) {
    throw new Error(`Invalid persisted redaction rule regex: ${(error as Error).message}`);
  }
  return validateRule({ ...candidate, pattern });
}

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

  async addRule(rule: RedactionRule): Promise<void> {
    const validated = validateRule(rule);
    await this._emit("secrets.redaction.rules.changed", {
      action: "add",
      ruleId: rule.id,
    });
    this.rules.set(validated.id, { ...validated, matchCount: 0 });
  }

  async removeRule(id: string): Promise<void> {
    if (!this.rules.has(id)) {
      throw new Error(`Rule '${id}' not found`);
    }
    await this._emit("secrets.redaction.rules.changed", {
      action: "remove",
      ruleId: id,
    });
    this.rules.delete(id);
  }

  async enableRule(id: string): Promise<void> {
    const rule = this._getRule(id);
    await this._emit("secrets.redaction.rules.changed", {
      action: "enable",
      ruleId: id,
    });
    rule.enabled = true;
  }

  async disableRule(id: string): Promise<void> {
    const rule = this._getRule(id);
    await this._emit("secrets.redaction.rules.changed", {
      action: "disable",
      ruleId: id,
    });
    rule.enabled = false;
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

  async importRules(filePath: string): Promise<void> {
    const raw = readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Invalid redaction rules config: expected an array");
    }
    const validated = parsed.map(parsePersistedRule);
    const ids = new Set<string>();
    for (const rule of validated) {
      if (ids.has(rule.id)) {
        throw new Error(`Invalid redaction rules config: duplicate id '${rule.id}'`);
      }
      ids.add(rule.id);
    }
    await this._emit("secrets.redaction.rules.changed", {
      action: "import",
      count: parsed.length,
    });
    for (const rule of validated) {
      this.rules.set(rule.id, { ...rule, matchCount: 0 });
    }
  }

  exportRules(filePath: string): void {
    const data = Array.from(this.rules.values()).map(({ matchCount: _mc, pattern, ...rest }) => ({
      ...rest,
      pattern: pattern.source,
      flags: pattern.flags,
    }));
    mkdirSync(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync(tempPath, JSON.stringify(data, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(tempPath, filePath);
    } finally {
      rmSync(tempPath, { force: true });
    }
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
