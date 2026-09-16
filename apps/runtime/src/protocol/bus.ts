// Barrel re-export for backward compatibility
// The bus module has been decomposed into smaller, focused modules.
// See ./bus/ directory for the individual module files.

export {
	type AuditRecord,
	type BusState,
	CommandBusImpl,
	type CommandBusOptions,
	type CommandEnvelope,
	createBus,
	type EventEnvelope,
	hasTopLevelDataField,
	InMemoryLocalBus,
	isCommandEnvelope,
	isEventEnvelope,
	isStartTopic,
	isTerminalTopic,
	LIFECYCLE_SEQUENCES,
	type LocalBus,
	type LocalBusEnvelopeWithSequence,
	type MetricSample,
	type MetricSummary,
	MetricsRecorder,
	type MetricsReport,
	publishLifecycleEvent,
	type ResponseEnvelope,
	resolveExpectedStartTopic,
	START_TOPICS,
	TERMINAL_TOPICS,
} from "./bus/index.js";
