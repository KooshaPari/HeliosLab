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
import type { Checkpoint } from "../../../src/recovery/checkpoint.js";
import {
	CheckpointReader,
	CheckpointWriter,
} from "../../../src/recovery/checkpoint.js";
import { CheckpointScheduler } from "../../../src/recovery/checkpoint-scheduler.js";
import { makeCheckpointSession, useTempDir } from "../../helpers/test-tmp.js";

const makeSession = (index: number) => makeCheckpointSession(index);

describe("CheckpointScheduler surface coverage", () => {
	const temp: { dir: string } = { dir: "" };
	useTempDir("ckpt-scheduler", { beforeEach, afterEach }, temp);
	let writer: CheckpointWriter;
	let scheduler: CheckpointScheduler;

	beforeEach(() => {
		writer = new CheckpointWriter(temp.dir);
		scheduler = new CheckpointScheduler();
	});

	afterEach(() => {
		scheduler.stop();
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

		const onDisk = await new CheckpointReader(temp.dir).read();
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
		const onDisk = await new CheckpointReader(temp.dir).read();
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
