import type { LocalBus } from "../protocol/bus";
import type { ProtocolTopic } from "../protocol/topics";

export type LaneState =
	| "new"
	| "provisioning"
	| "ready"
	| "running"
	| "blocked"
	| "shared"
	| "failed"
	| "cleaning"
	| "closed";
export type SessionState =
	| "detached"
	| "attaching"
	| "attached"
	| "restoring"
	| "terminated";
export type TerminalState =
	| "idle"
	| "spawning"
	| "active"
	| "throttled"
	| "errored"
	| "stopped";

export type RuntimeState = {
	lane: LaneState;
	session: SessionState;
	terminal: TerminalState;
};

export type RuntimeEvent =
	| "lane.create.requested"
	| "lane.create.succeeded"
	| "lane.create.failed"
	| "lane.run.started"
	| "lane.blocked"
	| "lane.share.started"
	| "lane.share.stopped"
	| "lane.cleanup.started"
	| "lane.cleanup.completed"
	| "session.attach.requested"
	| "session.attach.succeeded"
	| "session.attach.failed"
	| "session.restore.started"
	| "session.restore.completed"
	| "session.terminated"
	| "terminal.spawn.requested"
	| "terminal.spawn.succeeded"
	| "terminal.throttled"
	| "terminal.error"
	| "terminal.stopped";

export const INITIAL_RUNTIME_STATE: RuntimeState = {
	lane: "new",
	session: "detached",
	terminal: "idle",
};

const LANE_TRANSITIONS: Record<LaneState, LaneState[]> = {
	new: ["provisioning", "closed"],
	provisioning: ["ready", "failed", "closed"],
	ready: ["running", "blocked", "shared", "failed", "cleaning", "closed"],
	running: ["running", "blocked", "shared", "failed", "cleaning", "closed"],
	blocked: ["running", "failed", "cleaning", "closed"],
	shared: ["running", "failed", "cleaning", "closed"],
	failed: ["provisioning", "closed"],
	cleaning: ["closed"],
	closed: [],
};

export type LaneRecord = {
	lane_id: string;
	workspace_id: string;
	project_context_id: string;
	display_name: string;
	status: LaneState;
	created_at: string;
	updated_at: string;
};

export class LaneLifecycleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LaneLifecycleError";
	}
}

export class LaneLifecycleService {
	private readonly lanes = new Map<string, LaneRecord>();

	constructor(private readonly bus: LocalBus) {}

	async create(input: {
		workspace_id: string;
		project_context_id: string;
		display_name: string;
	}): Promise<LaneRecord> {
		const nowIso = new Date().toISOString();
		const laneId = `lane_${crypto.randomUUID()}`;
		const correlationId = `lane.create:${laneId}:${Date.now()}`;

		const lane: LaneRecord = {
			lane_id: laneId,
			workspace_id: input.workspace_id,
			project_context_id: input.project_context_id,
			display_name: input.display_name,
			status: "new",
			created_at: nowIso,
			updated_at: nowIso,
		};

		this.lanes.set(laneId, lane);
		await this.transition(
			laneId,
			"provisioning",
			"lane.create.started",
			"lane.create.requested",
			correlationId,
		);
		await this.transition(
			laneId,
			"ready",
			"lane.created",
			"lane.create.succeeded",
			correlationId,
		);
		return this.getRequired(laneId);
	}

	list(workspaceId: string): LaneRecord[] {
		const result: LaneRecord[] = [];
		for (const lane of this.lanes.values()) {
			if (lane.workspace_id === workspaceId) {
				result.push({ ...lane });
			}
		}
		return result;
	}

	async attach(workspaceId: string, laneId: string): Promise<LaneRecord> {
		const lane = this.getRequired(laneId);
		if (lane.workspace_id !== workspaceId) {
			throw new LaneLifecycleError(
				`lane ${laneId} does not belong to workspace ${workspaceId}`,
			);
		}
		if (lane.status === "running") {
			return lane;
		}

		await this.transition(
			laneId,
			"running",
			"lane.attached",
			"lane.run.started",
		);
		return this.getRequired(laneId);
	}

	async cleanup(workspaceId: string, laneId: string): Promise<LaneRecord> {
		const lane = this.getRequired(laneId);
		if (lane.workspace_id !== workspaceId) {
			throw new LaneLifecycleError(
				`lane ${laneId} does not belong to workspace ${workspaceId}`,
			);
		}
		if (lane.status === "closed") {
			return lane;
		}

		await this.transition(
			laneId,
			"closed",
			"lane.cleaned",
			"lane.cleanup.completed",
		);
		return this.getRequired(laneId);
	}

	getRequired(laneId: string): LaneRecord {
		const lane = this.lanes.get(laneId);
		if (!lane) {
			throw new LaneLifecycleError(`lane ${laneId} not found`);
		}

		return { ...lane };
	}

	private async transition(
		laneId: string,
		nextState: LaneState,
		topic: ProtocolTopic,
		runtimeEvent: RuntimeEvent,
		correlationId?: string,
	): Promise<void> {
		const lane = this.lanes.get(laneId);
		if (!lane) {
			throw new LaneLifecycleError(`lane ${laneId} not found`);
		}

		if (!LANE_TRANSITIONS[lane.status].includes(nextState)) {
			throw new LaneLifecycleError(
				`invalid lane transition ${lane.status} -> ${nextState}`,
			);
		}

		lane.status = nextState;
		lane.updated_at = new Date().toISOString();
		await this.bus.publish({
			id: `${laneId}:${runtimeEvent}:${Date.now()}`,
			type: "event",
			ts: new Date().toISOString(),
			workspace_id: lane.workspace_id,
			lane_id: lane.lane_id,
			correlation_id: correlationId,
			topic,
			payload: {
				runtime_event: runtimeEvent,
				lane_id: lane.lane_id,
				state: lane.status,
			},
		});
	}
}

export function transition(
	state: RuntimeState,
	event: RuntimeEvent,
): RuntimeState {
	switch (event) {
		case "lane.create.requested":
			return { ...state, lane: "provisioning" };
		case "lane.create.succeeded":
			return { ...state, lane: "ready" };
		case "lane.create.failed":
			return { ...state, lane: "failed" };
		case "lane.run.started":
			return { ...state, lane: "running" };
		case "lane.blocked":
			return { ...state, lane: "blocked" };
		case "lane.share.started":
			return { ...state, lane: "shared" };
		case "lane.share.stopped":
			return { ...state, lane: "running" };
		case "lane.cleanup.started":
			return { ...state, lane: "cleaning" };
		case "lane.cleanup.completed":
			return { ...state, lane: "closed" };
		case "session.attach.requested":
			return { ...state, session: "attaching" };
		case "session.attach.succeeded":
			return { ...state, session: "attached" };
		case "session.attach.failed":
			return { ...state, session: "detached" };
		case "session.restore.started":
			return { ...state, session: "restoring" };
		case "session.restore.completed":
			return { ...state, session: "attached" };
		case "session.terminated":
			return { ...state, session: "terminated" };
		case "terminal.spawn.requested":
			return { ...state, terminal: "spawning" };
		case "terminal.spawn.succeeded":
			return { ...state, terminal: "active" };
		case "terminal.throttled":
			return { ...state, terminal: "throttled" };
		case "terminal.error":
			return { ...state, terminal: "errored" };
		case "terminal.stopped":
			return { ...state, terminal: "stopped" };
		default:
			return state;
	}
}
