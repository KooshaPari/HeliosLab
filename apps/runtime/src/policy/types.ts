/**
 * Policy Rule Type Definitions
 * Defines the data model for command policy rules.
 */

/**
 * Classification level for a command based on policy rules.
 */
export enum PolicyClassification {
  /** Command is safe to execute directly */
  Safe = "safe",
  /** Command requires approval before execution */
  NeedsApproval = "needs-approval",
  /** Command is blocked and cannot be executed */
  Blocked = "blocked",
}

/**
 * Pattern matching type for policy rules.
 */
export enum PolicyPatternType {
  /** Unix glob pattern (e.g., "git *", "rm -rf *") */
  Glob = "glob",
  /** Regular expression pattern */
  Regex = "regex",
}

/**
 * A single policy rule that matches and classifies commands.
 */
export interface PolicyRule {
  /** Unique identifier for the rule */
  id: string;

  /** Pattern to match against command text (glob or regex) */
  pattern: string;

  /** Type of pattern matching */
  patternType: PolicyPatternType;

  /** Classification assigned if this rule matches */
  classification: PolicyClassification;

  /** Workspace ID this rule applies to */
  scope: string;

  /** Priority for rule ordering (lower = higher priority) */
  priority: number;

  /** Human-readable description of what this rule does */
  description: string;

  /** Optional file path patterns this rule targets (for file-affecting commands) */
  targets?: string[];

  /** Timestamp when rule was created (ISO 8601) */
  createdAt: string;

  /** Timestamp when rule was last updated (ISO 8601) */
  updatedAt: string;
}

/**
 * Input type for creating or updating policy rules.
 * Omits computed fields like timestamps.
 */
export interface PolicyRuleInput {
  id: string;
  pattern: string;
  patternType: PolicyPatternType;
  classification: PolicyClassification;
  scope: string;
  priority: number;
  description: string;
  targets?: string[];
}

/**
 * Context for evaluating a command against policies.
 */
export interface CommandContext {
  /** Workspace ID where command is being executed */
  workspaceId: string;

  /** ID of the agent executing the command */
  agentId: string;

  /** Paths affected by the command (for file-targeting rules) */
  affectedPaths?: string[];

  /** Whether this is a direct operator command vs agent-initiated */
  isDirect: boolean;
}

/**
 * Result of evaluating a command against policy rules.
 */
export interface PolicyEvaluationResult {
  /** Final classification of the command */
  classification: PolicyClassification;

  /** Rules that matched this command */
  matchedRules: PolicyRule[];

  /** Time taken to evaluate (milliseconds) */
  evaluationMs: number;

  /** Whether deny-by-default was applied (no matching rules) */
  deniedByDefault: boolean;
}
