import type { LocalBusEnvelope } from "../types.js";

// ---------------------------------------------------------------------------
// Lifecycle Sequences and Topic Sets
// ---------------------------------------------------------------------------

export const LIFECYCLE_SEQUENCES: Record<string, string[]> = {
	"session.attach": [
		"session.attach.started",
		"session.attached",
		"session.attach.failed",
	],
	"lane.create": ["lane.create.started", "lane.created", "lane.create.failed"],
	"terminal.spawn": [
		"terminal.spawn.started",
		"lane.attach.started",
		"terminal.spawned",
		"lane.attached",
		"lane.attach.failed",
		"terminal.spawn.failed",
	],
	"lane.attach": ["lane.attach.started", "lane.attached", "lane.attach.failed"],
};

export const TERMINAL_TOPICS = new Set([
	"session.attached",
	"session.attach.failed",
	"lane.created",
	"lane.create.failed",
	"terminal.spawned",
	"lane.attached",
	"lane.attach.failed",
	"terminal.spawn.failed",
]);

export const START_TOPICS = new Set([
	"session.attach.started",
	"lane.create.started",
	"terminal.spawn.started",
	"lane.attach.started",
]);

// ---------------------------------------------------------------------------
// Lifecycle Helper Functions
// ---------------------------------------------------------------------------

export function isTerminalTopic(topic: string): boolean {
	return TERMINAL_TOPICS.has(topic);
}

export function isStartTopic(topic: string): boolean {
	return START_TOPICS.has(topic);
}

export function resolveExpectedStartTopic(topic: string): string {
	return topic
		.replace(".attached", ".attach.started")
		.replace(
			".failed",
			topic.includes("attach")
				? ".attach.started"
				: topic.includes("create")
					? ".create.started"
					: topic.includes("spawn")
						? ".spawn.started"
						: "",
		)
		.replace(".created", ".create.started")
		.replace(".spawned", ".spawn.started");
}

export function publishLifecycleEvent(
	topic: string,
	envelope: LocalBusEnvelope,
	eventLog: LocalBusEnvelope[],
	auditLog: Array<{
		envelope: LocalBusEnvelope;
		outcome: "accepted" | "rejected";
		error?: string;
	}>,
): void {
	const seq = eventLog.filter((e) => e.type === "event").length + 1;
	const event: LocalBusEnvelope = {
		id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		type: "event",
		ts: new Date().toISOString(),
		topic,
		// biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
		...(envelope.workspace_id !== undefined
			? { workspace_id: envelope.workspace_id }
			: {}),
		// biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
		...(envelope.lane_id !== undefined ? { lane_id: envelope.lane_id } : {}),
		// biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
		...(envelope.session_id !== undefined
			? { session_id: envelope.session_id }
			: {}),
		// biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
		...(envelope.terminal_id !== undefined
			? { terminal_id: envelope.terminal_id }
			: {}),
		// biome-ignore lint/style/useNamingConvention: Protocol event envelope fields use protocol-defined snake_case.
		...(envelope.correlation_id !== undefined
			? { correlation_id: envelope.correlation_id }
			: {}),
		payload: {},
		sequence: seq,
	};
	auditLog.push({ envelope: event, outcome: "accepted" });
	eventLog.push(event);
}
