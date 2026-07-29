// Barrel re-export for backward compatibility
// The bus module has been decomposed into smaller, focused modules.
// See ./bus/ directory for the individual module files.

export {
  InMemoryLocalBus,
  CommandBusImpl,
  createBus,
  type LocalBus,
  type AuditRecord,
  type MetricSample,
  type MetricSummary,
  type MetricsReport,
  type BusState,
  type CommandBusOptions,
  type CommandEnvelope,
  type EventEnvelope,
  type ResponseEnvelope,
  type LocalBusEnvelopeWithSequence,
  LIFECYCLE_SEQUENCES,
  TERMINAL_TOPICS,
  START_TOPICS,
  isTerminalTopic,
  isStartTopic,
  resolveExpectedStartTopic,
  publishLifecycleEvent,
  MetricsRecorder,
  isCommandEnvelope,
  isEventEnvelope,
  hasTopLevelDataField,
} from "./bus/index.js";
