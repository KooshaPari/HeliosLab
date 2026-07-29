export { ZellijCli } from "./cli.js";
export { ZellijSessionManager, sessionNameForLane } from "./session.js";
export { MuxRegistry } from "./registry.js";
export { ZellijPaneManager } from "./panes.js";
export { ZellijTabManager } from "./tabs.js";
export { TopologyTracker } from "./topology.js";
export {
  MuxEventEmitter,
  MuxEventType,
  generateCorrelationId,
  type EventBus,
  type MuxEvent,
  type MuxEventBase,
  type SessionCreatedEvent,
  type SessionReattachedEvent,
  type SessionTerminatedEvent,
  type PaneAddedEvent,
  type PaneClosedEvent,
  type PaneResizedEvent,
  type PanePtyBoundEvent,
  type PaneDimensionRejectedEvent,
  type TabCreatedEvent,
  type TabClosedEvent,
  type TabSwitchedEvent,
} from "./events.js";
export { reconcile, type ReconciliationResult } from "./reconciliation.js";
export type {
  ZellijSession,
  SessionOptions,
  MuxSession,
  MuxBinding,
  PaneRecord,
  TabRecord,
  CliResult,
  AvailabilityResult,
  PaneDimensions,
  CreatePaneOptions,
  MinPaneDimensions,
  PaneTopology,
  TabTopology,
  LayoutTopology,
  PtyManagerInterface,
} from "./types.js";
export {
  ZellijNotFoundError,
  ZellijVersionError,
  ZellijCliError,
  ZellijTimeoutError,
  SessionNotFoundError,
  SessionAlreadyExistsError,
  DuplicateBindingError,
  PaneTooSmallError,
  PaneNotFoundError,
  TabNotFoundError,
  PtyBindingError,
} from "./errors.js";
