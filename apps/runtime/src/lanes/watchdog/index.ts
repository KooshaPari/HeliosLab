// Export watchdog modules

export { OrphanWatchdog, type WatchdogConfig } from "./orphan_watchdog.js";
export { CheckpointManager, type WatchdogCheckpoint } from "./checkpoint.js";
export {
  ResourceClassifier,
  type OrphanedResource,
  type ClassifiedOrphan,
  type ResourceType,
  type RiskLevel,
} from "./resource_classifier.js";
export { WorktreeDetector } from "./worktree_detector.js";
export { ZellijDetector, type SessionRegistry } from "./zellij_detector.js";
export { PtyDetector, type TerminalRegistry } from "./pty_detector.js";
export {
  RemediationEngine,
  type RemediationSuggestion,
  type CleanupResult,
} from "./remediation.js";
