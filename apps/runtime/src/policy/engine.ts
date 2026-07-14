/**
 * Policy Evaluation Engine
 * Evaluates commands against stored policy rules and determines approval requirements.
 */

import { PolicyStorage } from "./storage";
import { PolicyRuleSet } from "./rules";

/**
 * Policy evaluation engine for commands.
 */
export class PolicyEngine {
  private storage: PolicyStorage;
  private ruleCache: Map<string, PolicyRuleSet> = new Map();

  constructor(policyDir?: string) {
    this.storage = new PolicyStorage(policyDir);
    this.storage.onRulesChanged((workspaceId, _rules) => {
      this.ruleCache.delete(workspaceId);
    });
  }

  /**
   * Evaluate a command against the workspace's policy rules.
   */
  async evaluate(command: string, context: CommandContext): Promise<PolicyEvaluationResult> {
    const ruleSet = await this.storage.getRuleSet(context.workspaceId);
    return ruleSet.evaluate(command, context);
  }

  /**
   * Check if a command can be executed directly.
   */
  async canExecuteDirectly(command: string, context: CommandContext): Promise<boolean> {
    const result = await this.evaluate(command, context);
    return result.classification === PolicyClassification.Safe;
  }

  /**
   * Check if a command needs approval.
   */
  async needsApproval(command: string, context: CommandContext): Promise<boolean> {
    const result = await this.evaluate(command, context);
    return result.classification === PolicyClassification.NeedsApproval;
  }

  /**
   * Check if a command is blocked.
   */
  async isBlocked(command: string, context: CommandContext): Promise<boolean> {
    const result = await this.evaluate(command, context);
    return result.classification === PolicyClassification.Blocked;
  }

  /**
   * Close and cleanup.
   */
  close(): void {
    this.storage.close();
    this.ruleCache.clear();
  }
}
