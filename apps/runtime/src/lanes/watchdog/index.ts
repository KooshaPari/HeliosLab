// Export watchdog modules

export { CheckpointManager, type WatchdogCheckpoint } from "./checkpoint.js";
export { OrphanWatchdog, type WatchdogConfig } from "./orphan_watchdog.js";
export { PtyDetector, type TerminalRegistry } from "./pty_detector.js";
export {
	type CleanupResult,
	RemediationEngine,
	type RemediationSuggestion,
} from "./remediation.js";
export {
	type ClassifiedOrphan,
	type OrphanedResource,
	ResourceClassifier,
	type ResourceType,
	type RiskLevel,
} from "./resource_classifier.js";
export { WorktreeDetector } from "./worktree_detector.js";
export { type SessionRegistry, ZellijDetector } from "./zellij_detector.js";
