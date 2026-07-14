/**
 * Policy Storage
 * Persists policy rules to disk with in-memory caching and hot-swap support.
 */

import { promises as fs } from "fs";
import * as path from "path";

import { PolicyRuleSet } from "./rules";

export type RulesChangedCallback = (workspaceId: string, rules: PolicyRule[]) => void;

/**
 * Policy Storage with file persistence and hot-swap support.
 */
export class PolicyStorage {
  private cache: Map<string, PolicyRuleSet> = new Map();
  private policyDir: string;
  private watchers: Map<string, AbortController> = new Map();
  private changeCallbacks: RulesChangedCallback[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(policyDir: string = path.join(process.env.HOME || "/tmp", ".helios/policies")) {
    this.policyDir = policyDir;
  }

  /**
   * Load or get cached rule set for a workspace.
   */
  async getRuleSet(workspaceId: string): Promise<PolicyRuleSet> {
    // Return cached rule set if available
    if (this.cache.has(workspaceId)) {
      return this.cache.get(workspaceId)!;
    }

    // Load from file
    const rules = await this.loadRules(workspaceId);
    const ruleSet = new PolicyRuleSet();

    for (const rule of rules) {
      ruleSet.addRule(rule);
    }

    this.cache.set(workspaceId, ruleSet);

    // Start watching for changes
    this.watchFile(workspaceId);

    return ruleSet;
  }

  /**
   * Load rules from file for a workspace.
   * Returns empty array if file doesn't exist.
   */
  async loadRules(workspaceId: string): Promise<PolicyRule[]> {
    const filePath = path.join(this.policyDir, `${workspaceId}.json`);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const rules = JSON.parse(content) as PolicyRule[];

      // Validate rules
      this.validateRules(rules);

      return rules;
    } catch {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist: return empty (deny-by-default)
        return [];
      }
      throw new Error(`Failed to load policy rules for ${workspaceId}: ${error}`);
    }
  }

  /**
   * Save rules to file for a workspace.
   * Uses atomic write: temp file + rename.
   */
  async saveRules(workspaceId: string, rules: PolicyRule[]): Promise<void> {
    // Validate before saving
    this.validateRules(rules);

    // Ensure directory exists
    await fs.mkdir(this.policyDir, { recursive: true });

    const filePath = path.join(this.policyDir, `${workspaceId}.json`);
    const tempPath = `${filePath}.tmp`;

    try {
      // Write to temp file
      const content = JSON.stringify(rules, null, 2);
      await fs.writeFile(tempPath, content, "utf-8");

      // Atomic rename
      await fs.rename(tempPath, filePath);

      // Update cache
      const ruleSet = new PolicyRuleSet();
      for (const rule of rules) {
        ruleSet.addRule(rule);
      }
      this.cache.set(workspaceId, ruleSet);

      // Notify callbacks (debounced)
      this.notifyChangedDebounced(workspaceId, rules);
    } catch {
      // Clean up temp file
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Watch file for external changes and reload.
   */
  private watchFile(workspaceId: string): void {
    if (this.watchers.has(workspaceId)) {
      return; // Already watching
    }

    const filePath = path.join(this.policyDir, `${workspaceId}.json`);

    // Simple file watching using setInterval (cross-platform, no native watch needed)
    let lastMtime = 0;

    const checkFile = async () => {
      try {
        const stats = await fs.stat(filePath);
        const mtime = stats.mtime.getTime();

        if (mtime > lastMtime && lastMtime > 0) {
          // File changed
          try {
            const rules = await this.loadRules(workspaceId);
            const ruleSet = new PolicyRuleSet();
            for (const rule of rules) {
              ruleSet.addRule(rule);
            }
            this.cache.set(workspaceId, ruleSet);
            this.notifyChangedDebounced(workspaceId, rules);
          } catch {
            console.error(`Failed to reload policy rules for ${workspaceId}:`, error);
            // Keep previous rules on error
          }
        }

        lastMtime = mtime;
      } catch {
        // File doesn't exist yet or error reading
      }
    };

    const timer = setInterval(checkFile, 500); // Check every 500ms

    this.watchers.set(workspaceId, {
      abort: () => clearInterval(timer),
    } as any);

    // Check immediately
    checkFile();
  }

  /**
   * Notify change callbacks with debouncing.
   */
  private notifyChangedDebounced(workspaceId: string, rules: PolicyRule[]): void {
    // Clear existing timer
    if (this.debounceTimers.has(workspaceId)) {
      clearTimeout(this.debounceTimers.get(workspaceId)!);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.changeCallbacks.forEach(cb => cb(workspaceId, rules));
      this.debounceTimers.delete(workspaceId);
    }, 100); // Debounce 100ms

    this.debounceTimers.set(workspaceId, timer);
  }

  /**
   * Register a callback to be called when rules change.
   */
  onRulesChanged(callback: RulesChangedCallback): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Validate rules conform to schema.
   */
  private validateRules(rules: PolicyRule[]): void {
    if (!Array.isArray(rules)) {
      throw new Error("Rules must be an array");
    }

    for (const rule of rules) {
      if (!rule.id || typeof rule.id !== "string") {
        throw new Error("Rule must have an id field");
      }
      if (!rule.pattern || typeof rule.pattern !== "string") {
        throw new Error(`Rule ${rule.id} must have a pattern field`);
      }
      if (!rule.patternType || !["glob", "regex"].includes(rule.patternType)) {
        throw new Error(`Rule ${rule.id} has invalid patternType`);
      }
      if (
        !rule.classification ||
        !["safe", "needs-approval", "blocked"].includes(rule.classification)
      ) {
        throw new Error(`Rule ${rule.id} has invalid classification`);
      }
      if (typeof rule.priority !== "number") {
        throw new Error(`Rule ${rule.id} must have a numeric priority`);
      }
    }
  }

  /**
   * Close all watchers.
   */
  close(): void {
    for (const controller of this.watchers.values()) {
      controller.abort();
    }
    this.watchers.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.cache.clear();
    this.changeCallbacks = [];
  }
}
