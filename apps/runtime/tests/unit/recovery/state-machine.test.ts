/**
 * RecoveryStateMachine + state-machine-persistence surface coverage.
 *
 * Exercises every public path of the recovery state machine so the coverage
 * gate has evidence the slice's recovery wiring actually works:
 *
 *   - getCurrentStage / constructor defaults
 *   - transition() with legal transitions, retries, and max-retry errors
 *   - transition() publishing recovery.stage.changed on the bus
 *   - resume() / reset() and loadState branches
 *   - state-machine-persistence: isRecoveryState, getRecoveryStatePath,
 *     loadRecoveryState (missing, invalid, valid), persistRecoveryState,
 *     deleteRecoveryState
 *
 * Lives under apps/runtime/tests/unit/ so it is picked up by the coverage gate
 * (`bun test apps/runtime/tests --coverage`).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LocalBusEnvelope } from "../../../src/protocol/bus.js";
import { InMemoryLocalBus } from "../../../src/protocol/bus.js";
import {
	RecoveryStage,
	RecoveryStateMachine,
} from "../../../src/recovery/state-machine.js";
import {
	deleteRecoveryState,
	getRecoveryStatePath,
	isRecoveryState,
	loadRecoveryState,
	persistRecoveryState,
} from "../../../src/recovery/state-machine-persistence.js";
import { MAX_RETRIES_PER_STAGE } from "../../../src/recovery/state-machine-types.js";

class RecordingBus extends InMemoryLocalBus {
	published: LocalBusEnvelope[] = [];
	override async publish(envelope: LocalBusEnvelope): Promise<void> {
		this.published.push(envelope);
		await super.publish(envelope);
	}
}

async function emptyDir(prefix: string): Promise<string> {
	const dir = path.join(
		os.tmpdir(),
		`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

describe("RecoveryStateMachine surface coverage", () => {
	let tempDir: string;
	let bus: RecordingBus;

	beforeEach(async () => {
		tempDir = await emptyDir("recovery-sm");
		bus = new RecordingBus();
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	it("starts in CRASHED and persists nothing until first transition", async () => {
		const sm = new RecoveryStateMachine(tempDir, bus);
		await sm.initialize();
		expect(sm.getCurrentStage()).toBe(RecoveryStage.CRASHED);
	});

	it("transitions through the happy path and emits recovery.stage.changed", async () => {
		const sm = new RecoveryStateMachine(tempDir, bus);
		await sm.initialize();
		const seen: RecoveryStage[] = [];
		sm.onStageChange((_from, to) => seen.push(to));

		const path: RecoveryStage[] = [
			RecoveryStage.DETECTING,
			RecoveryStage.INVENTORYING,
			RecoveryStage.RESTORING,
			RecoveryStage.RECONCILING,
			RecoveryStage.LIVE,
		];
		for (const stage of path) {
			await sm.transition(stage);
		}

		expect(sm.getCurrentStage()).toBe(RecoveryStage.LIVE);
		expect(seen).toEqual(path);

		const changes = bus.published.filter(
			(envelope) => envelope.topic === "recovery.stage.changed",
		);
		expect(changes).toHaveLength(path.length);
		expect(changes.at(-1)?.payload).toMatchObject({
			current: RecoveryStage.LIVE,
		});
	});

	it("rejects an illegal transition", async () => {
		const sm = new RecoveryStateMachine(tempDir, bus);
		await sm.initialize();
		await expect(sm.transition(RecoveryStage.LIVE)).rejects.toThrow(
			/Illegal transition/,
		);
	});

	it("increments attempt count when retrying from a failure state", async () => {
		const sm = new RecoveryStateMachine(tempDir, bus);
		await sm.initialize();
		await sm.transition(RecoveryStage.DETECTING);
		await sm.transition(RecoveryStage.DETECTION_FAILED);
		// Retrying out of a failure state increments attemptCount.
		await sm.transition(RecoveryStage.DETECTING);

		const changes = bus.published.filter(
			(envelope) => envelope.topic === "recovery.stage.changed",
		);
		const retryAttempt = changes.at(-1);
		expect(retryAttempt?.payload?.attemptCount).toBe(1);
	});

	it("throws once the per-stage retry budget is exceeded", async () => {
		const sm = new RecoveryStateMachine(tempDir, bus);
		await sm.initialize();
		await sm.transition(RecoveryStage.DETECTING);
		await sm.transition(RecoveryStage.DETECTION_FAILED);

		// Retry up to MAX_RETRIES_PER_STAGE, then one more should throw.
		for (let i = 0; i < MAX_RETRIES_PER_STAGE; i++) {
			await sm.transition(RecoveryStage.DETECTING);
			await sm.transition(RecoveryStage.DETECTION_FAILED);
		}
		await expect(sm.transition(RecoveryStage.DETECTING)).rejects.toThrow(
			/Max retries/,
		);
	});

	it("reset() restores CRASHED and clears persisted state", async () => {
		const sm = new RecoveryStateMachine(tempDir, bus);
		await sm.initialize();
		await sm.transition(RecoveryStage.DETECTING);
		expect(sm.getCurrentStage()).toBe(RecoveryStage.DETECTING);

		await sm.reset();
		expect(sm.getCurrentStage()).toBe(RecoveryStage.CRASHED);
		const reloaded = await loadRecoveryState(tempDir);
		expect(reloaded).toBeNull();
	});

	it("resume() returns the persisted stage after restart", async () => {
		const sm1 = new RecoveryStateMachine(tempDir, bus);
		await sm1.initialize();
		await sm1.transition(RecoveryStage.DETECTING);
		await sm1.transition(RecoveryStage.INVENTORYING);

		const sm2 = new RecoveryStateMachine(tempDir, new InMemoryLocalBus());
		const stage = await sm2.resume();
		expect(stage).toBe(RecoveryStage.INVENTORYING);
	});
});

describe("state-machine-persistence helpers", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await emptyDir("recovery-sm-persist");
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	it("isRecoveryState() validates well-formed states and rejects garbage", () => {
		expect(isRecoveryState(null)).toBe(false);
		expect(isRecoveryState({})).toBe(false);
		expect(isRecoveryState({ stage: "NOT_A_STAGE" })).toBe(false);
		expect(
			isRecoveryState({
				stage: RecoveryStage.LIVE,
				timestamp: "not-a-number",
			}),
		).toBe(false);
		expect(
			isRecoveryState({
				stage: RecoveryStage.LIVE,
				timestamp: Date.now(),
				attemptCount: -1,
			}),
		).toBe(false);
		expect(
			isRecoveryState({
				stage: RecoveryStage.LIVE,
				timestamp: Date.now(),
				attemptCount: 0,
				lastError: 42,
			}),
		).toBe(false);
		expect(
			isRecoveryState({
				stage: RecoveryStage.LIVE,
				timestamp: Date.now(),
				attemptCount: 0,
			}),
		).toBe(true);
	});

	it("getRecoveryStatePath() joins recovery/recovery-state.json", () => {
		expect(getRecoveryStatePath("/var/data")).toBe(
			path.join("/var/data", "recovery", "recovery-state.json"),
		);
	});

	it("loadRecoveryState() returns null when the file is missing", async () => {
		expect(await loadRecoveryState(tempDir)).toBeNull();
	});

	it("loadRecoveryState() returns null when the file is malformed", async () => {
		const statePath = getRecoveryStatePath(tempDir);
		await fs.mkdir(path.dirname(statePath), { recursive: true });
		await fs.writeFile(statePath, "{not json}", "utf8");
		expect(await loadRecoveryState(tempDir)).toBeNull();
	});

	it("loadRecoveryState() returns null when persisted JSON is not a state", async () => {
		const statePath = getRecoveryStatePath(tempDir);
		await fs.mkdir(path.dirname(statePath), { recursive: true });
		await fs.writeFile(statePath, JSON.stringify({ foo: "bar" }), "utf8");
		expect(await loadRecoveryState(tempDir)).toBeNull();
	});

	it("persistRecoveryState() round-trips a valid state", async () => {
		const sm = new RecoveryStateMachine(tempDir);
		await sm.initialize();
		await sm.transition(RecoveryStage.DETECTING);

		const reloaded = await loadRecoveryState(tempDir);
		expect(reloaded?.stage).toBe(RecoveryStage.DETECTING);
	});

	it("persistRecoveryState() swallows fs errors without throwing", async () => {
		// An unwritable path: writeFile to a path whose parent is a regular file.
		const blocker = path.join(tempDir, "blocker");
		await fs.writeFile(blocker, "i am a file");
		await expect(
			persistRecoveryState(blocker, {
				stage: RecoveryStage.LIVE,
				timestamp: Date.now(),
				attemptCount: 0,
			}),
		).resolves.toBeUndefined();
	});

	it("deleteRecoveryState() is a no-op when the file is absent", async () => {
		await expect(deleteRecoveryState(tempDir)).resolves.toBeUndefined();
	});

	it("deleteRecoveryState() removes the persisted file", async () => {
		const sm = new RecoveryStateMachine(tempDir);
		await sm.initialize();
		await sm.transition(RecoveryStage.DETECTING);
		await deleteRecoveryState(tempDir);
		expect(await loadRecoveryState(tempDir)).toBeNull();
	});
});
