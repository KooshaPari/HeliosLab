/**
 * Policy Rule Engine
 * Evaluates commands against policy rules with denylist-wins conflict resolution.
 */

import {
  type PolicyRule,
  PolicyClassification,
  PolicyPatternType,
  type CommandContext,
  type PolicyEvaluationResult,
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
        if (!this.regexCache.has(pattern)) {
          this.regexCache.set(pattern, new RegExp(pattern));
        }
        const regex = this.regexCache.get(pattern)!;
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
    const _startTime = performance.now();
    const matchedRules: PolicyRule[] = [];
    let hasBlockedRule = false;
    let hasApprovalRule = false;

    // Iterate rules in priority order
    for (const rule of this.rules) {
      // Check if pattern matches
      const patternMatches = this.patternMatcher.matches(command, rule.pattern, rule.patternType);

      if (!patternMatches) {
        continue;
      }

      // Check if file targets match (if specified)
      if (rule.targets && rule.targets.length > 0) {
        if (!context.affectedPaths || context.affectedPaths.length === 0) {
          continue;
        }

        const hasMatchingPath = context.affectedPaths.some(path => {
          return rule.targets!.some(target => {
            return this.patternMatcher.matches(path, target, PolicyPatternType.Glob);
          });
        });

        if (!hasMatchingPath) {
          continue;
        }
      }

      // Rule matches
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
}
