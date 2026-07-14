import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProtectedPathMatch {
  patternId: string;
  pattern: string;
  matchedPath: string;
  warningMessage: string;
  command: string;
}

export interface ProtectedPathPattern {
  id: string;
  pattern: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface ProtectedPathAcknowledgment {
  patternId: string;
  matchedPath: string;
  acknowledgedAt: number;
}

// ---------------------------------------------------------------------------
// Default protected path patterns
// ---------------------------------------------------------------------------

const DEFAULT_PATTERNS: ProtectedPathPattern[] = [
  {
    id: "dotenv",
    pattern: ".env",
    description: ".env files (exact and variants like .env.local, .env.production)",
    enabled: true,
    isDefault: true,
  },
  {
    id: "credentials-json",
    pattern: "credentials.json",
    description: "Generic credentials.json files",
    enabled: true,
    isDefault: true,
  },
  {
    id: "credentials-yaml",
    pattern: "credentials.yaml",
    description: "Generic credentials.yaml files",
    enabled: true,
    isDefault: true,
  },
  {
    id: "credentials-yml",
    pattern: "credentials.yml",
    description: "Generic credentials.yml files",
    enabled: true,
    isDefault: true,
  },
  {
    id: "secrets-dir",
    pattern: "**/secrets/**",
    description: "Any path containing a secrets directory",
    enabled: true,
    isDefault: true,
  },
  {
    id: "ssh-private-key",
    pattern: "~/.ssh/id_*",
    description: "SSH private key files",
    enabled: true,
    isDefault: true,
  },
  {
    id: "aws-credentials",
    pattern: "~/.aws/credentials",
    description: "AWS credentials file",
    enabled: true,
    isDefault: true,
  },
  {
    id: "aws-config",
    pattern: "~/.aws/config",
    description: "AWS config file",
    enabled: true,
    isDefault: true,
  },
  {
    id: "gcloud-adc",
    pattern: "~/.config/gcloud/application_default_credentials.json",
    description: "GCP application default credentials",
    enabled: true,
    isDefault: true,
  },
  {
    id: "gcp-service-account",
    pattern: "**/service-account*.json",
    description: "GCP service account key files",
    enabled: true,
    isDefault: true,
  },
];

// Commands that reference files as arguments
const FILE_ARG_COMMANDS = [
  "cat",
  "less",
  "more",
  "head",
  "tail",
  "vim",
  "vi",
  "nano",
  "emacs",
  "code",
  "cp",
  "mv",
  "scp",
  "rsync",
  "source",
  ".",
];

// ---------------------------------------------------------------------------
// Glob-like matching
// ---------------------------------------------------------------------------

function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize home directory references
  const expandedPattern = pattern.replace(/^~\//, "");
  const expandedPath = filePath.replace(/^~\//, "").replace(/^\/home\/[^/]+\//, "");

  // For .env pattern: match .env and .env.* variants
  if (pattern === ".env") {
    const base = filePath.split("/").pop() ?? filePath;
    return base === ".env" || base.startsWith(".env.");
  }

  // Direct filename match (no glob)
  if (!pattern.includes("*") && !pattern.includes("?")) {
    const base = filePath.split("/").pop() ?? filePath;
    const patBase = pattern.split("/").pop() ?? pattern;
    if (base === patBase) return true;
    // Full path match
    if (filePath.endsWith(pattern) || filePath === pattern) return true;
    if (expandedPath.endsWith(expandedPattern) || expandedPath === expandedPattern) return true;
    return false;
  }

  // Convert glob pattern to regex
  const regexSource = globToRegex(pattern);
  const regex = new RegExp(regexSource, "i");
  return regex.test(filePath) || regex.test(expandedPath);
}

function globToRegex(glob: string): string {
  // Escape special regex characters except * and ?
  let result = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      result += ".*";
      i += 2;
      if (glob[i] === "/") i++; // consume optional slash after **
    } else if (ch === "*") {
      result += "[^/]*";
      i++;
    } else if (ch === "?") {
      result += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      result += "\\" + ch;
      i++;
    } else {
      result += ch;
      i++;
    }
  }
  return "(^|/|^.*[/\\\\])" + result + "($|[/\\\\])";
}

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

function extractFilePaths(command: string): string[] {
  const paths: string[] = [];
  const tokens = tokenizeCommand(command);

  if (tokens.length === 0) return paths;

  const cmd = tokens[0];

  // Handle `curl -d @file` or `curl --data @file`
  if (cmd === "curl") {
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if ((tok === "-d" || tok === "--data" || tok === "--data-binary") && i + 1 < tokens.length) {
        const next = tokens[i + 1];
        if (next.startsWith("@")) paths.push(next.slice(1));
        i++;
      } else if (tok.startsWith("@")) {
        paths.push(tok.slice(1));
      }
    }
    return paths;
  }

  // Handle scp: source and dest can be remote:path or local path
  if (cmd === "scp") {
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.startsWith("-")) continue;
      // Skip remote:path patterns (contain colon)
      if (tok.includes(":")) continue;
      paths.push(tok);
    }
    return paths;
  }

  // For common file-reading commands, treat all non-flag tokens as paths
  if (FILE_ARG_COMMANDS.includes(cmd)) {
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.startsWith("-")) {
        paths.push(tok);
      }
    }
    return paths;
  }

  // For any other command, extract tokens that look like file paths
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.startsWith("-") && looksLikeFilePath(tok)) {
      paths.push(tok);
    }
  }

  return paths;
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function looksLikeFilePath(tok: string): boolean {
  return (
    tok.startsWith("/") ||
    tok.startsWith("~/") ||
    tok.startsWith("./") ||
    tok.startsWith("../") ||
    tok.includes(".") ||
    tok.includes("/")
  );
}

// ---------------------------------------------------------------------------
// ProtectedPathConfig
// ---------------------------------------------------------------------------

export class ProtectedPathConfig {
  private patterns: Map<string, ProtectedPathPattern> = new Map();
  private bus: LocalBus | null;
  private configPath: string | null;

  constructor(opts?: { bus?: LocalBus; configPath?: string }) {
    this.bus = opts?.bus ?? null;
    this.configPath = opts?.configPath ?? null;

    // Load defaults
    for (const p of DEFAULT_PATTERNS) {
      this.patterns.set(p.id, { ...p });
    }
  }

  addPattern(pattern: string, description: string): ProtectedPathPattern {
    if (!pattern || pattern.trim() === "") {
      throw new Error("Pattern must not be empty");
    }
    // Reject overly broad patterns
    if (pattern === "*" || pattern === "**" || pattern === "**/*" || pattern === "*.*") {
      throw new Error(`Pattern '${pattern}' is too broad and would match all paths`);
    }
    // Warn on patterns that match common non-sensitive paths but still add them
    const id = `custom-${randomBytes(4).toString("hex")}`;
    const entry: ProtectedPathPattern = {
      id,
      pattern,
      description,
      enabled: true,
      isDefault: false,
    };
    this.patterns.set(id, entry);
    void this._emit("secrets.protected_paths.config.changed", {
      action: "add",
      patternId: id,
      pattern,
    });
    return entry;
  }

  removePattern(id: string): void {
    if (!this.patterns.has(id)) {
      throw new Error(`Pattern '${id}' not found`);
    }
    this.patterns.delete(id);
    void this._emit("secrets.protected_paths.config.changed", {
      action: "remove",
      patternId: id,
    });
  }

  disablePattern(id: string): void {
    const p = this.patterns.get(id);
    if (!p) throw new Error(`Pattern '${id}' not found`);
    p.enabled = false;
    void this._emit("secrets.protected_paths.config.changed", {
      action: "disable",
      patternId: id,
    });
  }

  enablePattern(id: string): void {
    const p = this.patterns.get(id);
    if (!p) throw new Error(`Pattern '${id}' not found`);
    p.enabled = true;
    void this._emit("secrets.protected_paths.config.changed", {
      action: "enable",
      patternId: id,
    });
  }

  listPatterns(): ProtectedPathPattern[] {
    return Array.from(this.patterns.values());
  }

  async importPatterns(path: string): Promise<void> {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as ProtectedPathPattern[];
    for (const p of parsed) {
      if (!p.id || !p.pattern) continue;
      this.patterns.set(p.id, { ...p });
    }
    void this._emit("secrets.protected_paths.config.changed", {
      action: "import",
      count: parsed.length,
    });
  }

  async exportPatterns(path: string): Promise<void> {
    const data = Array.from(this.patterns.values());
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  }

  async loadFromDisk(): Promise<void> {
    if (!this.configPath || !existsSync(this.configPath)) return;
    await this.importPatterns(this.configPath);
  }

  async saveToDisk(): Promise<void> {
    if (!this.configPath) return;
    await this.exportPatterns(this.configPath);
  }

  getEnabledPatterns(): ProtectedPathPattern[] {
    return Array.from(this.patterns.values()).filter(p => p.enabled);
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

// ---------------------------------------------------------------------------
// ProtectedPathDetector
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

export class ProtectedPathDetector {
  private config: ProtectedPathConfig;
  private bus: LocalBus | null;
  private warningCallbacks: Array<(match: ProtectedPathMatch) => void> = [];
  // key: `${patternId}:${matchedPath}` -> timestamp
  private acknowledgments: Map<string, ProtectedPathAcknowledgment> = new Map();

  constructor(opts?: { config?: ProtectedPathConfig; bus?: LocalBus }) {
    this.config = opts?.config ?? new ProtectedPathConfig();
    this.bus = opts?.bus ?? null;
  }

  getConfig(): ProtectedPathConfig {
    return this.config;
  }

  /**
   * Scans a terminal command for protected path references.
   * Returns all matches and fires warning callbacks + bus events.
   */
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

          // Redact the command (strip any inline secret-looking values)
          const redactedCommand = redactCommandForAudit(command);

          const match: ProtectedPathMatch = {
            patternId: pattern.id,
            pattern: pattern.pattern,
            matchedPath: filePath,
            warningMessage: `Command accesses protected path '${filePath}' matching pattern '${pattern.description}'`,
            command: redactedCommand,
          };
          matches.push(match);

          // Emit bus event
          void this._emit("secrets.protected_path.accessed", {
            patternId: pattern.id,
            pattern: pattern.pattern,
            matchedPath: filePath,
            command: redactedCommand,
            terminalId: opts?.terminalId ?? null,
            correlationId: opts?.correlationId ?? randomBytes(8).toString("hex"),
          });

          // Fire callbacks
          for (const cb of this.warningCallbacks) {
            cb(match);
          }
        }
      }
    }

    return matches;
  }

  /**
   * Register a callback for warning delivery.
   */
  onWarning(callback: (match: ProtectedPathMatch) => void): void {
    this.warningCallbacks.push(callback);
  }

  /**
   * Acknowledge a warning, preventing re-trigger within debounce window.
   */
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

  /**
   * Check if a path+pattern combination is within the debounce window.
   */
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips inline secret-looking values from a command before audit persistence.
 * Covers common patterns like `export FOO=secret` or `curl -H "Authorization: Bearer token"`.
 */
function redactCommandForAudit(command: string): string {
  return command
    .replace(/(?:AKIA[0-9A-Z]{16})/g, "[REDACTED:AWS_ACCESS_KEY]")
    .replace(/(?:AIza[0-9A-Za-z\-_]{35})/g, "[REDACTED:GCP_API_KEY]")
    .replace(/(?:sk-[A-Za-z0-9]{48,})/g, "[REDACTED:OPENAI_KEY]")
    .replace(/(?:gh[ps]_[A-Za-z0-9_]{36,})/g, "[REDACTED:GITHUB_TOKEN]")
    .replace(/(?:Bearer [A-Za-z0-9\-._~+/]+=*)/g, "Bearer [REDACTED:TOKEN]")
    .replace(
      /(?:(?:api_key|apikey|API_KEY)\s*[=:]\s*["']?)([A-Za-z0-9\-_]{16,})["']?/gi,
      (_, _k) => "[REDACTED:API_KEY]"
    );
}
