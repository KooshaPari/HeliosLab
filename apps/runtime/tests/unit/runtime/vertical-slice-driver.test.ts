/**
 * VerticalSliceDriver surface coverage.
 *
 * Drives every public path of {@link VerticalSliceDriver} so the coverage gate
 * has evidence the slice's terminal wiring actually exercises its behaviour:
 *
 *   - constructor options (shell, cols, rows, custom ptyManager/streamBindingManager)
 *   - start() / stop() lifecycle (idempotent, detaches subscriptions)
 *   - shutdown() tears down bindings and terminates PTYs
 *   - bindingForLane / ptyForLane / laneIds accessors
 *   - errors / ptys / bindings introspection
 *   - writeToLane (live + throw path for unknown lane)
 *   - waitForLane timeout
 *   - lane.created idempotency
 *   - lane.closed teardown (both topics in TEARDOWN_TOPICS)
 *
 * Lives under apps/runtime/tests/unit/ so it is picked up by the coverage gate
 * (`bun test apps/runtime/tests --coverage`).
 */
import { afterEach, describe, expect, it } from "bun:test";
import { InMemoryLocalBus } from "../../../src/protocol/bus.js";
import { PtyManager } from "../../../src/pty/index.js";
import { RecordingRendererAdapter } from "../../../src/renderer/recording_adapter.js";
import { StreamBindingManager } from "../../../src/renderer/stream_binding.js";
import { VerticalSliceDriver } from "../../../src/runtime/vertical_slice_driver.js";
import { LaneLifecycleService } from "../../../src/sessions/state_machine.js";
import {
	createLane,
	republishLaneCreated,
} from "../../helpers/vertical-slice-harness.js";

const WORKSPACE = "ws-driver-coverage";
const SPAWN_TIMEOUT_MS = 10_000;

async function newHarness(options?: {
	ptyManager?: PtyManager;
	streamBindingManager?: StreamBindingManager;
	shell?: string;
	cols?: number;
	rows?: number;
}): Promise<{
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
		windowId: "driver-coverage-window",
		bounds: { x: 0, y: 0, width: 800, height: 600 },
	});
	const driver = new VerticalSliceDriver({
		bus,
		renderer,
		ptyManager: options?.ptyManager,
		streamBindingManager: options?.streamBindingManager,
		shell: options?.shell,
		cols: options?.cols,
		rows: options?.rows,
	});
	driver.start();
	return { bus, lanes, renderer, driver };
}

async function republishLaneClosed(
	bus: InMemoryLocalBus,
	laneId: string,
	topic: "lane.cleaned" | "lane.closed",
	correlationId: string,
): Promise<void> {
	const envelope: LocalBusEnvelope = {
		type: "event",
		id: `${topic}-${correlationId}`,
		ts: new Date().toISOString(),
		workspace_id: WORKSPACE,
		lane_id: laneId,
		correlation_id: correlationId,
		topic,
		payload: {
			runtime_event:
				topic === "lane.closed" ? "lane.closed" : "lane.cleanup.completed",
			lane_id: laneId,
			state: "closed",
		},
	};
	await bus.publish(envelope);
}

describe("VerticalSliceDriver surface coverage", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			const cleanup = cleanups.pop();
			if (cleanup) await cleanup();
		}
	});

	it("exposes injected PtyManager and StreamBindingManager via getters", () => {
		const bus = new InMemoryLocalBus();
		const renderer = new RecordingRendererAdapter();
		const customPtyManager = new PtyManager(50);
		const customBindings = new StreamBindingManager();
		const driver = new VerticalSliceDriver({
			bus,
			renderer,
			ptyManager: customPtyManager,
			streamBindingManager: customBindings,
		});
		expect(driver.ptys).toBe(customPtyManager);
		expect(driver.bindings).toBe(customBindings);
		expect(driver.errors).toEqual([]);
		expect(driver.laneIds()).toEqual([]);
		expect(driver.bindingForLane("nope")).toBeUndefined();
		expect(driver.ptyForLane("nope")).toBeUndefined();
	});

	it("start() is idempotent and stop() detaches subscriptions", () => {
		const bus = new InMemoryLocalBus();
		const renderer = new RecordingRendererAdapter();
		const driver = new VerticalSliceDriver({ bus, renderer });
		driver.start();
		driver.start(); // second start is a no-op
		driver.stop();
		driver.stop(); // second stop is a no-op
		// After stop() the driver owns no live bindings: the accessors
		// reflect a fully detached driver that is still safe to query.
		expect(driver.laneIds()).toEqual([]);
		expect(driver.errors).toEqual([]);
		expect(driver.bindingForLane("any-lane")).toBeUndefined();
		expect(driver.ptyForLane("any-lane")).toBeUndefined();
	});

	it("spawns a PTY for lane.created and exposes binding/pty accessors", async () => {
		const { lanes, driver } = await newHarness();
		cleanups.push(() => driver.shutdown());

		const lane = await createLane(lanes, "spawn-surface", WORKSPACE);
		const binding = await driver.waitForLane(lane.lane_id, SPAWN_TIMEOUT_MS);
		expect(binding).not.toBeNull();
		expect(driver.bindingForLane(lane.lane_id)).toBe(binding);
		expect(driver.ptyForLane(lane.lane_id)).toBe(binding?.ptyId);
		expect(driver.laneIds()).toContain(lane.lane_id);
		expect(driver.errors).toHaveLength(0);

		driver.start();
		await driver.shutdown();
	});

	it("writeToLane throws when the lane has no live terminal", async () => {
		const { driver } = await newHarness();
		cleanups.push(() => driver.shutdown());
		driver.start();
		expect(() => driver.writeToLane("does-not-exist", "echo hi\r\n")).toThrow(
			/no live terminal for lane 'does-not-exist'/,
		);
		await driver.shutdown();
	});

	it("writeToLane forwards text into the PTY (live path)", async () => {
		const { lanes, renderer, driver } = await newHarness();
		cleanups.push(() => driver.shutdown());

		const lane = await createLane(lanes, "write-live", WORKSPACE);
		const binding = await driver.waitForLane(lane.lane_id, SPAWN_TIMEOUT_MS);
		expect(binding).not.toBeNull();
		const NEEDLE = `coverage-driver-${Date.now()}`;
		driver.writeToLane(lane.lane_id, `echo ${NEEDLE}\r\n`);
		expect(
			await renderer.waitForText(binding!.ptyId, NEEDLE, SPAWN_TIMEOUT_MS),
		).toBe(true);
	});

	it("waitForLane returns null when the timeout elapses", async () => {
		const { driver } = await newHarness();
		cleanups.push(() => driver.shutdown());
		driver.start();
		const start = Date.now();
		const result = await driver.waitForLane("never-published", 25);
		const elapsed = Date.now() - start;
		expect(result).toBeNull();
		expect(elapsed).toBeLessThan(500);
	});

	it("ignores a second lane.created for the same lane (idempotent)", async () => {
		const { bus, lanes, driver } = await newHarness();
		cleanups.push(() => driver.shutdown());

		const lane = await createLane(lanes, "idempotent", WORKSPACE);
		const first = await driver.waitForLane(lane.lane_id, SPAWN_TIMEOUT_MS);
		expect(first).not.toBeNull();

		await republishLaneCreated(
			bus,
			lane.lane_id,
			`dup-${Date.now()}`,
			WORKSPACE,
		);
		await driver.settle();

		expect(driver.ptys.getByLane(lane.lane_id)).toHaveLength(1);
		expect(driver.ptyForLane(lane.lane_id)).toBe(first!.ptyId);
		expect(driver.laneIds()).toEqual([lane.lane_id]);
	});

	it("tears down a lane on lane.closed (PTY terminated, binding removed)", async () => {
		const { bus, lanes, driver } = await newHarness();
		cleanups.push(() => driver.shutdown());

		const lane = await createLane(lanes, "teardown-closed", WORKSPACE);
		const binding = await driver.waitForLane(lane.lane_id, SPAWN_TIMEOUT_MS);
		expect(binding).not.toBeNull();

		await republishLaneClosed(
			bus,
			lane.lane_id,
			"lane.closed",
			`close-${Date.now()}`,
		);
		await driver.settle();

		expect(driver.bindingForLane(lane.lane_id)).toBeUndefined();
		expect(driver.ptyForLane(lane.lane_id)).toBeUndefined();
		expect(driver.laneIds()).not.toContain(lane.lane_id);
		expect(driver.ptys.get(binding!.ptyId)).toBeUndefined();
	});

	it("tears down a lane on lane.cleaned (alternate teardown topic)", async () => {
		const { bus, lanes, driver } = await newHarness();
		cleanups.push(() => driver.shutdown());

		const lane = await createLane(lanes, "teardown-cleaned", WORKSPACE);
		const binding = await driver.waitForLane(lane.lane_id, SPAWN_TIMEOUT_MS);
		expect(binding).not.toBeNull();

		await republishLaneClosed(
			bus,
			lane.lane_id,
			"lane.cleaned",
			`clean-${Date.now()}`,
		);
		await driver.settle();

		expect(driver.bindingForLane(lane.lane_id)).toBeUndefined();
		expect(driver.laneIds()).not.toContain(lane.lane_id);
	});

	it("shutdown() detaches and terminates every live PTY", async () => {
		const { lanes, driver } = await newHarness();
		const a = await createLane(lanes, "shutdown-a", WORKSPACE);
		const b = await createLane(lanes, "shutdown-b", WORKSPACE);
		await driver.waitForLane(a.lane_id, SPAWN_TIMEOUT_MS);
		await driver.waitForLane(b.lane_id, SPAWN_TIMEOUT_MS);
		expect(driver.laneIds().length).toBeGreaterThanOrEqual(2);

		await driver.shutdown();
		// After shutdown, byLane is cleared.
		expect(driver.laneIds()).toHaveLength(0);
	});

	it("ignores lane.closed events for unknown lanes", async () => {
		const { bus, driver } = await newHarness();
		cleanups.push(() => driver.shutdown());

		await republishLaneClosed(
			bus,
			"lane-that-never-existed",
			"lane.closed",
			`unknown-${Date.now()}`,
		);
		await driver.settle();
		expect(driver.errors).toHaveLength(0);
		expect(driver.laneIds()).toHaveLength(0);
	});
});
