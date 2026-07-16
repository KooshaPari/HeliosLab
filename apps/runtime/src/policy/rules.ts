/**
 * Policy Rule Engine
 * Evaluates commands against policy rules with denylist-wins conflict resolution.
 */

import { DEFAULT_PATTERNS, matchesPattern } from "../secrets/protected-paths-matching";
import {
  type CommandContext,
  PolicyClassification,
  type PolicyEvaluationResult,
  PolicyPatternType,
  type PolicyRule,
} from "./types";

/**
 * Pattern matcher for glob and regex patterns.
 */
class PatternMatcher {
  private regexCache: Map<string, RegExp> = new Map();

  /**
   * Test if a command matches a pattern.
   */
  matches(command: string, pattern: string, type: PolicyPatternType): boolean {
    if (type === PolicyPatternType.Regex) {
      try {
        // Cache compiled regex for performance
        let regex = this.regexCache.get(pattern);
        if (!regex) {
          regex = new RegExp(pattern);
          this.regexCache.set(pattern, regex);
        }
        return regex.test(command);
      } catch {
        return false;
      }
    } else {
      // Simple glob matching (glob via wildcard expansion)
      return this.globMatch(command, pattern);
    }
  }

  /**
   * Simple glob pattern matching.
   * Supports * for any characters.
   */
  private globMatch(text: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex chars
      .replace(/\*/g, ".*"); // * becomes .*
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
  }
}

/**
 * Policy Rule Set
 * Holds and evaluates an ordered collection of rules for a workspace.
 */
export class PolicyRuleSet {
  private rules: PolicyRule[] = [];
  private patternMatcher = new PatternMatcher();

  /**
   * Add a rule to the set, maintaining sort order by priority.
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Remove a rule by ID.
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  /**
   * Update an existing rule, maintaining sort order.
   */
  updateRule(ruleId: string, updates: Partial<PolicyRule>): void {
    const index = this.rules.findIndex(r => r.id === ruleId);
    if (index !== -1) {
      this.rules[index] = { ...this.rules[index], ...updates };
      this.rules.sort((a, b) => a.priority - b.priority);
    }
  }

  /**
   * Evaluate a command against all rules.
   * Applies denylist-wins conflict resolution:
   * 1. If any matching rule is "blocked", result is blocked.
   * 2. Among remaining matches, most restrictive wins (needs-approval > safe).
   * 3. If no rules match, returns "blocked" (deny-by-default).
   */
  evaluate(command: string, context: CommandContext): PolicyEvaluationResult {
    const startTime = performance.now();
    const matchedRules: PolicyRule[] = [];
    let hasBlockedRule = false;
    let hasApprovalRule = false;

    for (const rule of this.getProtectedPathDenyRules(context)) {
      matchedRules.push(rule);
      hasBlockedRule = true;
    }

    // Iterate rules in priority order
    for (const rule of this.rules) {
      if (!this.matchesRule(rule, command, context)) continue;
      matchedRules.push(rule);

      // Track classifications for conflict resolution
      if (rule.classification === PolicyClassification.Blocked) {
        hasBlockedRule = true;
      } else if (rule.classification === PolicyClassification.NeedsApproval) {
        hasApprovalRule = true;
      }
    }

    // Determine final classification
    let classification: PolicyClassification;
    let deniedByDefault = false;

    if (matchedRules.length === 0) {
      // No matching rules: deny-by-default
      classification = PolicyClassification.Blocked;
      deniedByDefault = true;
    } else if (hasBlockedRule) {
      // Denylist-wins: any blocked rule blocks the command
      classification = PolicyClassification.Blocked;
    } else if (hasApprovalRule) {
      // Most restrictive wins: needs-approval > safe
      classification = PolicyClassification.NeedsApproval;
    } else {
      // All matches are safe
      classification = PolicyClassification.Safe;
    }

    const evaluationMs = performance.now() - startTime;

    return {
      classification,
      matchedRules,
      evaluationMs,
      deniedByDefault,
    };
  }

  /**
   * Get the number of rules in this set.
   */
  getRuleCount(): number {
    return this.rules.length;
  }

  /**
   * Get all rules (for testing/inspection).
   */
  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  private matchesRule(rule: PolicyRule, command: string, context: CommandContext): boolean {
    if (rule.scope !== context.workspaceId) return false;
    if (!this.patternMatcher.matches(command, rule.pattern, rule.patternType)) return false;

    const targets = rule.targets;
    if (!targets || targets.length === 0) return true;

    const affectedPaths = context.affectedPaths;
    if (!affectedPaths || affectedPaths.length === 0) return false;

    return affectedPaths.some(path =>
      targets.some(target => this.patternMatcher.matches(path, target, PolicyPatternType.Glob))
    );
  }

  private getProtectedPathDenyRules(context: CommandContext): PolicyRule[] {
    const affectedPaths = context.affectedPaths;
    if (!affectedPaths || affectedPaths.length === 0) {
      return [];
    }

    return DEFAULT_PATTERNS.filter(
      pattern =>
        pattern.enabled && affectedPaths.some(path => matchesPattern(path, pattern.pattern))
    ).map(pattern => ({
      id: `protected-path:${pattern.id}`,
      pattern: "*",
      patternType: PolicyPatternType.Glob,
      classification: PolicyClassification.Blocked,
      scope: context.workspaceId,
      priority: Number.MIN_SAFE_INTEGER,
      description: `Built-in protected path denylist: ${pattern.description}`,
      targets: [pattern.pattern],
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
    }));
  }
}
