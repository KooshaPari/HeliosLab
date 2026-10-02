import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../../index.js";
import type { CheckpointSession } from "../checkpoint.js";

/**
 * Durability integration tests.
 *
 * Proves the full cycle:
 *   createRuntime(dataDir) -> start -> checkpoint -> read -> shutdown -> read
 *
 * Traces to: SC-027-001 (crash-to-live recovery), SC-027-002 (checkpoint integrity).
 */
describe("Durability layer integration", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `durability-int-${Date.now()}`);
		await fs.mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	const makeSession = (index: number): CheckpointSession => ({
		sessionId: `sess-${index}`,
		terminalId: `term-${index}`,
		laneId: `lane-${index}`,
		workingDirectory: tempDir,
		environmentVariables: {},
		scrollbackSnapshot: `output-${index}`,
		zelijjSessionName: `zellij-${index}`,
		shellCommand: "bash",
	});

	it("createRuntime with dataDir exposes a durability layer", () => {
		const rt = createRuntime({ dataDir: tempDir });
		expect(rt.durability).toBeDefined();
		expect(rt.startDurability).toBeDefined();
	});

	it("createRuntime without dataDir has no durability layer", () => {
		const rt = createRuntime();
		expect(rt.durability).toBeUndefined();
	});

	it("checkpointNow writes a checkpoint that readCheckpoint can read", async () => {
		const rt = createRuntime({ dataDir: tempDir });
		const sessions = [makeSession(0), makeSession(1)];

		await rt.startDurability(() => sessions);
		await rt.durability!.checkpointNow();

		const checkpoint = await rt.durability!.readCheckpoint();
		expect(checkpoint).not.toBeNull();
		expect(checkpoint!.version).toBe(1);
		expect(checkpoint!.sessions).toHaveLength(2);
		expect(checkpoint!.sessions[0].sessionId).toBe("sess-0");
		expect(checkpoint!.sessions[1].sessionId).toBe("sess-1");
		expect(checkpoint!.checksum).toBeTypeOf("string");
		expect(checkpoint!.checksum.length).toBeGreaterThan(0);

		await rt.durability!.shutdown();
	});

	it("checkpoint persists across a new DurabilityLayer instance", async () => {
		// First instance: write checkpoint
		const rt1 = createRuntime({ dataDir: tempDir });
		await rt1.startDurability(() => [makeSession(42)]);
		await rt1.durability!.checkpointNow();
		await rt1.durability!.shutdown();

		// Second instance: read checkpoint from same dataDir
		const rt2 = createRuntime({ dataDir: tempDir });
		await rt2.startDurability(() => []);
		const checkpoint = await rt2.durability!.readCheckpoint();
		expect(checkpoint).not.toBeNull();
		expect(checkpoint!.sessions[0].sessionId).toBe("sess-42");
		await rt2.durability!.shutdown();
	});

	it("empty snapshot produces a checkpoint with zero sessions", async () => {
		const rt = createRuntime({ dataDir: tempDir });
		await rt.startDurability(() => []);
		await rt.durability!.checkpointNow();

		const checkpoint = await rt.durability!.readCheckpoint();
		expect(checkpoint).not.toBeNull();
		expect(checkpoint!.sessions).toHaveLength(0);
		await rt.durability!.shutdown();
	});

	it("recovery stage is accessible after start", async () => {
		const rt = createRuntime({ dataDir: tempDir });
		await rt.startDurability(() => []);
		const stage = rt.durability!.getRecoveryStage();
		expect(stage).toBeTypeOf("string");
		expect(stage.length).toBeGreaterThan(0);
		await rt.durability!.shutdown();
	});

	it("safe mode is not active on fresh start", async () => {
		const rt = createRuntime({ dataDir: tempDir });
		await rt.startDurability(() => []);
		expect(rt.durability!.isSafeModeActive()).toBe(false);
		await rt.durability!.shutdown();
	});

	it("multiple checkpointNow calls are idempotent", async () => {
		const rt = createRuntime({ dataDir: tempDir });
		let callCount = 0;
		await rt.startDurability(() => {
			callCount++;
			return [makeSession(callCount)];
		});

		await rt.durability!.checkpointNow();
		await rt.durability!.checkpointNow();
		await rt.durability!.checkpointNow();

		const checkpoint = await rt.durability!.readCheckpoint();
		expect(checkpoint).not.toBeNull();
		// The last call should have written its snapshot
		expect(checkpoint!.sessions[0].sessionId).toBe(`sess-${callCount}`);
		await rt.durability!.shutdown();
	});
});
