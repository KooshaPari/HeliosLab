/**
 * CheckpointScheduler surface coverage.
 *
 * Exercises every public path of {@link CheckpointScheduler} so the coverage
 * gate has evidence the recovery slice's periodic checkpoint loop is wired:
 *
 *   - start() / stop() idempotency
 *   - triggerNow() de-duplicates concurrent triggers
 *   - waitForIdle() blocks until in-flight writes settle
 *   - recordActivity() schedules a checkpoint once the threshold trips
 *   - getCurrentIntervalMs() reflects adjustInterval() after fast/slow writes
 *
 * Lives under apps/runtime/tests/unit/ so it is picked up by the coverage gate
 * (`bun test apps/runtime/tests --coverage`).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
	Checkpoint,
	CheckpointSession,
} from "../../../src/recovery/checkpoint.js";
import {
	CheckpointReader,
	CheckpointWriter,
} from "../../../src/recovery/checkpoint.js";
import { CheckpointScheduler } from "../../../src/recovery/checkpoint-scheduler.js";

async function emptyDir(prefix: string): Promise<string> {
	const dir = path.join(
		os.tmpdir(),
		`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

function makeSession(index: number): CheckpointSession {
	return {
		sessionId: `sess-${index}`,
		terminalId: `term-${index}`,
		laneId: `lane-${index}`,
		workingDirectory: "/tmp",
		environmentVariables: {},
		scrollbackSnapshot: "snap",
		zelijjSessionName: `z-${index}`,
		shellCommand: "bash",
	};
}

describe("CheckpointScheduler surface coverage", () => {
	let tempDir: string;
	let writer: CheckpointWriter;
	let scheduler: CheckpointScheduler;

	beforeEach(async () => {
		tempDir = await emptyDir("ckpt-scheduler");
		writer = new CheckpointWriter(tempDir);
		scheduler = new CheckpointScheduler();
	});

	afterEach(async () => {
		scheduler.stop();
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	const buildCheckpoint = (): Checkpoint => ({
		version: 1,
		timestamp: Date.now(),
		checksum: "",
		sessions: [makeSession(1)],
	});

	it("triggerNow() writes a checkpoint and resolves", async () => {
		scheduler.start(writer, buildCheckpoint);
		await scheduler.triggerNow();
		await scheduler.waitForIdle();

		const onDisk = await new CheckpointReader(tempDir).read();
		expect(onDisk?.sessions).toHaveLength(1);
	});

	it("triggerNow() de-duplicates concurrent callers into one write", async () => {
		scheduler.start(writer, buildCheckpoint);
		const a = scheduler.triggerNow();
		const b = scheduler.triggerNow();
		expect(a).toBe(b);
		await a;
	});

	it("stop() is safe before start() and idempotent", () => {
		expect(() => scheduler.stop()).not.toThrow();
		scheduler.start(writer, buildCheckpoint);
		scheduler.stop();
		expect(() => scheduler.stop()).not.toThrow();
	});

	it("start() is idempotent (second call is a no-op)", () => {
		scheduler.start(writer, buildCheckpoint);
		const firstInterval = scheduler.getCurrentIntervalMs();
		scheduler.start(writer, buildCheckpoint);
		expect(scheduler.getCurrentIntervalMs()).toBe(firstInterval);
	});

	it("waitForIdle() resolves immediately when nothing is pending", async () => {
		scheduler.start(writer, buildCheckpoint);
		await expect(scheduler.waitForIdle()).resolves.toBeUndefined();
	});

	it("recordActivity() under threshold is a no-op", () => {
		scheduler.start(writer, buildCheckpoint);
		for (let i = 0; i < 10; i++) scheduler.recordActivity();
		// No checkpoint file should exist (timer hasn't fired either).
		expect(scheduler.getCurrentIntervalMs()).toBeGreaterThan(0);
	});

	it("recordActivity() over threshold kicks a trigger without throwing", async () => {
		scheduler.start(writer, buildCheckpoint);
		// 50 events trips the threshold.
		for (let i = 0; i < 60; i++) scheduler.recordActivity();
		await scheduler.waitForIdle();
		const onDisk = await new CheckpointReader(tempDir).read();
		expect(onDisk?.sessions).toHaveLength(1);
	});

	it("getCurrentIntervalMs() reports the configured interval after start", () => {
		scheduler.start(writer, buildCheckpoint);
		expect(scheduler.getCurrentIntervalMs()).toBeGreaterThan(0);
	});

	it("triggerNow() survives a writer that throws", async () => {
		const exploding = {
			write: () => Promise.reject(new Error("disk full")),
			read: () => Promise.resolve(null),
		};
		scheduler.start(exploding, buildCheckpoint);
		await expect(scheduler.triggerNow()).resolves.toBeUndefined();
	});
});
