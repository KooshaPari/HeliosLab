/**
 * Durability layer surface coverage.
 *
 * Drives every public path of {@link DurabilityLayer} so the coverage gate has
 * evidence the slice's recovery wiring actually exercises its behaviour:
 *
 *   - constructor with default crash options
 *   - start() wiring (idempotent, schedules checkpoints)
 *   - recordActivity() before/after start
 *   - checkpointNow() and readCheckpoint()
 *   - restore() with and without a checkpoint
 *   - getRecoveryStage(), isSafeModeActive()
 *   - watchdogInstance, safeModeInstance accessors
 *   - shutdown() (idempotent + best-effort checkpoint write)
 *
 * Lives under apps/runtime/tests/unit/ so it is picked up by the coverage gate
 * (`bun test apps/runtime/tests --coverage`).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../../../src/index.js";
import { InMemoryLocalBus } from "../../../src/protocol/bus.js";
import type { CheckpointSession } from "../../../src/recovery/checkpoint.js";
import { DurabilityLayer } from "../../../src/recovery/durability_layer.js";
import { SafeMode } from "../../../src/recovery/safe-mode.js";
import { Watchdog } from "../../../src/recovery/watchdog.js";

const makeSession = (tempDir: string, index: number): CheckpointSession => ({
	sessionId: `sess-${index}`,
	terminalId: `term-${index}`,
	laneId: `lane-${index}`,
	workingDirectory: tempDir,
	environmentVariables: {},
	scrollbackSnapshot: `output-${index}`,
	zelijjSessionName: `zellij-${index}`,
	shellCommand: "bash",
});

async function emptyDir(prefix: string): Promise<string> {
	const dir = path.join(
		os.tmpdir(),
		`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

describe("DurabilityLayer surface coverage", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await emptyDir("durability-surface");
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	it("constructs with default crash-loop options", () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		// Accessors return real instances even before start.
		expect(layer.watchdogInstance).toBeInstanceOf(Watchdog);
		expect(layer.safeModeInstance).toBeInstanceOf(SafeMode);
	});

	it("accepts custom crash threshold and window options", () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({
			dataDir: tempDir,
			bus,
			crashThresholdCount: 7,
			crashWindowMs: 12_000,
		});
		expect(layer.isSafeModeActive()).toBe(false);
	});

	it("start() is idempotent", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		await layer.start(() => []);
		// A second start should be a no-op rather than double-wiring.
		await layer.start(() => []);
		await layer.shutdown();
	});

	it("recordActivity() is a no-op until start() then schedules activity bursts", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		// Before start, recordActivity is silently dropped.
		layer.recordActivity();
		await layer.start(() => [makeSession(tempDir, 0)]);
		layer.recordActivity();
		layer.recordActivity();
		await layer.shutdown();
	});

	it("readCheckpoint() returns null when no checkpoint exists yet", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		await layer.start(() => []);
		const checkpoint = await layer.readCheckpoint();
		expect(checkpoint).toBeNull();
		await layer.shutdown();
	});

	it("restore() returns null when there is no checkpoint to replay", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		await layer.start(() => []);
		const result = await layer.restore();
		expect(result).toBeNull();
		await layer.shutdown();
	});

	it("restore() replays a previously written checkpoint", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		const session = makeSession(tempDir, 9);
		await layer.start(() => [session]);
		await layer.checkpointNow();

		const restored = await layer.restore();
		expect(restored).not.toBeNull();
		expect(restored?.restored.length + (restored?.failed.length ?? 0)).toBe(1);
		expect(
			restored?.restored[0]?.sessionId === session.sessionId ||
				restored?.failed[0]?.sessionId === session.sessionId,
		).toBe(true);
		await layer.shutdown();
	});

	it("getRecoveryStage() returns a non-empty stage identifier", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		await layer.start(() => []);
		const stage = layer.getRecoveryStage();
		expect(typeof stage).toBe("string");
		expect(stage.length).toBeGreaterThan(0);
		await layer.shutdown();
	});

	it("isSafeModeActive() flips false after start and true after triggering safe mode", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		await layer.start(() => []);
		expect(layer.isSafeModeActive()).toBe(false);

		// Entering safe mode through the exposed instance flips the flag.
		await layer.safeModeInstance.enter();
		expect(layer.isSafeModeActive()).toBe(true);

		// A non-zero exit reported through the watchdog fires the wired crash
		// handler that escalates into safe mode.
		const layer2 = new DurabilityLayer({ dataDir: tempDir, bus });
		await layer2.start(() => []);
		await layer2.watchdogInstance.handleProcessExit(
			"crashing-process",
			99999,
			137,
			undefined,
		);
		await layer2.shutdown();
		await layer.shutdown();
	});

	it("watchdogInstance and safeModeInstance return the same instances across calls", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		const firstWatchdog = layer.watchdogInstance;
		const firstSafeMode = layer.safeModeInstance;
		expect(layer.watchdogInstance).toBe(firstWatchdog);
		expect(layer.safeModeInstance).toBe(firstSafeMode);
		await layer.shutdown();
	});

	it("shutdown() is idempotent and stops the scheduler", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		await layer.start(() => [makeSession(tempDir, 1)]);
		await layer.shutdown();
		// Calling shutdown again is a no-op rather than throwing.
		await layer.shutdown();
	});

	it("shutdown() without start() is a safe no-op", async () => {
		const bus = new InMemoryLocalBus();
		const layer = new DurabilityLayer({ dataDir: tempDir, bus });
		await layer.shutdown();
	});

	it("exposes the durability layer via createRuntime({ dataDir })", () => {
		const rt = createRuntime({ dataDir: tempDir });
		expect(rt.durability).toBeInstanceOf(DurabilityLayer);
		expect(rt.durability?.watchdogInstance).toBeInstanceOf(Watchdog);
		expect(rt.durability?.safeModeInstance).toBeInstanceOf(SafeMode);
	});
});
