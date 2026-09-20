/**
 * Shared scaffolding for `VerticalSliceDriver` tests.
 *
 * The coverage-raising commits (470a26b8 and 8a449464) added
 * `apps/runtime/tests/unit/runtime/vertical-slice-driver.test.ts` whose
 * lane-lifecycle helpers were byte-identical to the colocated
 * `apps/runtime/src/runtime/vertical-slice.test.ts`. Centralising the helpers
 * here removes that duplication while letting each suite keep its own
 * `WORKSPACE` id and project-context prefix.
 *
 * Lives under `apps/runtime/tests/helpers/` so both the unit test and the
 * colocated test can import it without pulling runtime code into a `tests/`
 * entry point.
 */

import type { InMemoryLocalBus } from "../../src/protocol/bus.js";
import type { LocalBusEnvelope } from "../../src/protocol/types.js";
import type { LaneLifecycleService } from "../../src/sessions/state_machine.js";

export interface VerticalSliceLaneHandle {
	lane_id: string;
}

/**
 * Create a lane via `LaneLifecycleService`. `projectContextId` defaults to
 * `"pc-driver"` to match the unit-test convention; the colocated slice test
 * passes `"pc-slice"` for parity with its existing assertions.
 */
export async function createLane(
	lanes: LaneLifecycleService,
	displayName: string,
	workspaceId: string,
	projectContextId = "pc-driver",
): Promise<VerticalSliceLaneHandle> {
	return lanes.create({
		workspace_id: workspaceId,
		project_context_id: projectContextId,
		display_name: displayName,
	}) as Promise<VerticalSliceLaneHandle>;
}

/**
 * Publish a syntactically valid start+terminal pair for an existing lane.
 *
 * `lane.created` is a terminal topic, so the bus rejects it unless a matching
 * `lane.create.started` was published first for the same correlation id.
 */
export async function republishLaneCreated(
	bus: InMemoryLocalBus,
	laneId: string,
	correlationId: string,
	workspaceId: string,
): Promise<void> {
	const base = {
		type: "event" as const,
		ts: new Date().toISOString(),
		workspace_id: workspaceId,
		lane_id: laneId,
		correlation_id: correlationId,
	};
	const started: LocalBusEnvelope = {
		...base,
		id: `start-${correlationId}`,
		topic: "lane.create.started",
		payload: {
			runtime_event: "lane.create.requested",
			lane_id: laneId,
			state: "provisioning",
		},
	};
	const created: LocalBusEnvelope = {
		...base,
		id: `created-${correlationId}`,
		topic: "lane.created",
		payload: {
			runtime_event: "lane.create.succeeded",
			lane_id: laneId,
			state: "ready",
		},
	};
	await bus.publish(started);
	await bus.publish(created);
}
