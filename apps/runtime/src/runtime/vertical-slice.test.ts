/**
 * Terminal-first vertical slice.
 *
 * Proves the flow the runtime never had. Before this slice the runtime wrote
 * terminal output to an in-memory buffer and published events on a bus that
 * dispatched to nobody; no process was ever spawned and no renderer was ever
 * reached. These tests assert the wired path end to end:
 *
 *   lane.create   -> pty.spawn -> renderer.bindStream -> bytes reach a surface
 *   lane.cleanup  -> renderer.unbindStream -> the surface freezes
 *
 * @see docs/specs/014-terminal-to-lane-session-binding/spec.md
 */

import { describe, expect, it } from "bun:test";
import { InMemoryLocalBus } from "../protocol/bus.js";
import type { LocalBusEnvelope } from "../protocol/types.js";
import { RecordingRendererAdapter } from "../renderer/recording_adapter.js";
import { LaneLifecycleService } from "../sessions/state_machine.js";
import { VerticalSliceDriver } from "./vertical_slice_driver.js";

const NEEDLE = "helios-vertical-slice-ok";
/** CRLF keeps the echoed command valid for both cmd.exe and POSIX shells. */
const EOL = "\r\n";
const WORKSPACE = "ws-slice";
const SPAWN_TIMEOUT_MS = 20_000;

async function newHarness(): Promise<{
	bus: InMemoryLocalBus;
	lanes: LaneLifecycleService;
	renderer: RecordingRendererAdapter;
	driver: VerticalSliceDriver;
}> {
	const bus = new InMemoryLocalBus();
	const lanes = new LaneLifecycleService(bus);
	const renderer = new RecordingRendererAdapter();
	await renderer.init({
		gpuAcceleration: false,
		colorDepth: 24,
		maxDimensions: { cols: 200, rows: 50 },
	});
	await renderer.start({
		windowId: "slice-window",
		bounds: { x: 0, y: 0, width: 800, height: 600 },
	});
	const driver = new VerticalSliceDriver({ bus, renderer });
	driver.start();
	return { bus, lanes, renderer, driver };
}

function createLane(
	lanes: LaneLifecycleService,
	displayName: string,
): Promise<{ lane_id: string }> {
	return lanes.create({
		workspace_id: WORKSPACE,
		project_context_id: "pc-slice",
		display_name: displayName,
	});
}

/**
 * Publish a syntactically valid start+terminal pair for an existing lane.
 *
 * `lane.created` is a terminal topic, so the bus rejects it unless a matching
 * `lane.create.started` was published first for the same correlation id.
 */
async function republishLaneCreated(
	bus: InMemoryLocalBus,
	laneId: string,
	correlationId: string,
): Promise<void> {
	const base = {
		type: "event" as const,
		ts: new Date().toISOString(),
		workspace_id: WORKSPACE,
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

describe("terminal-first vertical slice", () => {
	it("routes PTY output from a lane to a renderer surface", async () => {
		const { lanes, renderer, driver } = await newHarness();
		try {
			const lane = await createLane(lanes, "slice");
			const binding = await driver.waitForLane(lane.lane_id, SPAWN_TIMEOUT_MS);

			expect(binding).not.toBeNull();
			expect(binding?.ptyId).toBeString();
			// The lane owns exactly one registered live PTY.
			expect(driver.ptys.getByLane(lane.lane_id)).toHaveLength(1);
			expect(driver.ptys.get(binding!.ptyId)).toBeDefined();
			// The PTY's stdout is bound into the renderer surface.
			expect(driver.bindings.count()).toBe(1);
			expect(renderer.boundPtyIds).toContain(binding!.ptyId);

			driver.writeToLane(lane.lane_id, `echo ${NEEDLE}${EOL}`);

			const observed = await renderer.waitForText(
				binding!.ptyId,
				NEEDLE,
				SPAWN_TIMEOUT_MS,
			);
			expect(observed).toBe(true);
			expect(renderer.textFor(binding!.ptyId)).toContain(NEEDLE);
			expect(renderer.cells.length).toBeGreaterThan(0);
			expect(renderer.activeSurface?.windowId).toBe("slice-window");
			expect(driver.errors).toHaveLength(0);
		} finally {
			await driver.shutdown();
		}
	});

	it("freezes the renderer surface when the lane is cleaned up", async () => {
		const { lanes, renderer, driver } = await newHarness();
		try {
			const lane = await createLane(lanes, "slice-cleanup");
			const binding = await driver.waitForLane(lane.lane_id, SPAWN_TIMEOUT_MS);
			expect(binding).not.toBeNull();

			driver.writeToLane(lane.lane_id, `echo ${NEEDLE}${EOL}`);
			expect(
				await renderer.waitForText(binding!.ptyId, NEEDLE, SPAWN_TIMEOUT_MS),
			).toBe(true);

			await lanes.cleanup(WORKSPACE, lane.lane_id);
			await driver.settle();

			// Detached on every side: driver, binding manager, renderer.
			expect(driver.bindingForLane(lane.lane_id)).toBeUndefined();
			expect(driver.bindings.count()).toBe(0);
			expect(renderer.boundPtyIds).not.toContain(binding!.ptyId);

			const frozen = renderer.cellsFor(binding!.ptyId).length;
			expect(frozen).toBeGreaterThan(0);
			await new Promise((resolve) => setTimeout(resolve, 250));
			expect(renderer.cellsFor(binding!.ptyId).length).toBe(frozen);
		} finally {
			await driver.shutdown();
		}
	});

	it("does not spawn a second PTY for a repeated lane.created", async () => {
		const { bus, lanes, driver } = await newHarness();
		try {
			const lane = await createLane(lanes, "slice-idempotent");
			const first = await driver.waitForLane(lane.lane_id, SPAWN_TIMEOUT_MS);
			expect(first).not.toBeNull();

			await republishLaneCreated(bus, lane.lane_id, "dup-correlation");
			await driver.settle();

			expect(driver.ptys.getByLane(lane.lane_id)).toHaveLength(1);
			expect(driver.ptyForLane(lane.lane_id)).toBe(first!.ptyId);
			expect(driver.laneIds()).toEqual([lane.lane_id]);
			expect(driver.bindings.count()).toBe(1);
		} finally {
			await driver.shutdown();
		}
	});

	it("gives concurrent lanes independent PTYs and renderer surfaces", async () => {
		const { lanes, renderer, driver } = await newHarness();
		try {
			const a = await createLane(lanes, "slice-a");
			const b = await createLane(lanes, "slice-b");
			const c = await createLane(lanes, "slice-c");

			const bindings = await Promise.all([
				driver.waitForLane(a.lane_id, SPAWN_TIMEOUT_MS),
				driver.waitForLane(b.lane_id, SPAWN_TIMEOUT_MS),
				driver.waitForLane(c.lane_id, SPAWN_TIMEOUT_MS),
			]);
			const ptyIds = bindings.map((entry) => entry?.ptyId);
			expect(ptyIds.every((id) => typeof id === "string")).toBe(true);
			expect(new Set(ptyIds).size).toBe(3);
			expect(driver.bindings.count()).toBe(3);

			driver.writeToLane(a.lane_id, `echo ${NEEDLE}-a${EOL}`);
			driver.writeToLane(b.lane_id, `echo ${NEEDLE}-b${EOL}`);
			driver.writeToLane(c.lane_id, `echo ${NEEDLE}-c${EOL}`);

			expect(
				await renderer.waitForText(ptyIds[0]!, `${NEEDLE}-a`, SPAWN_TIMEOUT_MS),
			).toBe(true);
			expect(
				await renderer.waitForText(ptyIds[1]!, `${NEEDLE}-b`, SPAWN_TIMEOUT_MS),
			).toBe(true);
			expect(
				await renderer.waitForText(ptyIds[2]!, `${NEEDLE}-c`, SPAWN_TIMEOUT_MS),
			).toBe(true);

			// Output is not cross-wired between lanes.
			expect(renderer.textFor(ptyIds[0]!)).not.toContain(`${NEEDLE}-b`);
			expect(renderer.textFor(ptyIds[1]!)).not.toContain(`${NEEDLE}-a`);
			expect(driver.errors).toHaveLength(0);
		} finally {
			await driver.shutdown();
		}
	});
});
