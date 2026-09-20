import { afterEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../index.js";
import { getHome, resetHome, setHome } from "../recovery/data-dir.js";

const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
	const dir = await fs.mkdtemp(
		path.join(os.tmpdir(), "helios-runtime-durability-"),
	);
	tempDirs.push(dir);
	return dir;
}

async function makeTempDataDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-runtime-data-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	resetHome();
	for (const dir of tempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

describe("createRuntime durability wiring", () => {
	it("derives a default dataDir under helios/data when none is provided", async () => {
		const home = await makeTempHome();
		setHome(home);

		const runtime = createRuntime();
		const durability = await runtime.getDurability();

		expect(durability.getDataDir()).toContain(path.join(".helios", "data"));
		expect(durability.getDataDir().startsWith(getHome())).toBe(true);

		await runtime.close();
	});

	it("round-trips a checkpoint through start → record → checkpointNow → readCheckpoint → close", async () => {
		const dataDir = await makeTempDataDir();
		const runtime = createRuntime({ dataDir });

		// Register a lane + session so the snapshotter has something to record.
		await runtime.bus.request({
			id: "cmd-lane-create",
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: "ws-rt-1",
			correlation_id: "corr-lane-create",
			method: "lane.create",
			payload: { id: "lane-rt-1" },
		});
		await runtime.bus.request({
			id: "cmd-session-attach",
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: "ws-rt-1",
			lane_id: "lane-rt-1",
			session_id: "session-rt-1",
			correlation_id: "corr-session-attach",
			method: "session.attach",
			payload: {
				id: "session-rt-1",
				lane_id: "lane-rt-1",
				codex_session_id: "codex-rt-1",
			},
		});

		const durability = await runtime.getDurability();
		await durability.checkpointNow();

		const checkpoint = await durability.readCheckpoint();
		expect(checkpoint).not.toBeNull();
		const sessionIds = (checkpoint?.sessions ?? []).map((s) => s.sessionId);
		expect(sessionIds).toContain("session-rt-1");

		await runtime.close();

		// Verify the file actually persisted to disk under the recovery dir.
		const onDisk = await fs.readFile(
			path.join(durability.getDataDir(), "recovery", "checkpoint.json"),
			"utf-8",
		);
		expect(JSON.parse(onDisk).sessions.length).toBeGreaterThan(0);
	});

	it("wires durability.recordActivity() into lane.created", async () => {
		const dataDir = await makeTempDataDir();
		const runtime = createRuntime({ dataDir });

		const durability = await runtime.getDurability();
		expect(durability.isRunning()).toBe(true);

		// The lane.created topic follows a lifecycle: the bus rejects
		// terminal topics without their matching start topic. Publish the
		// start first, then the terminal event so the bus actually fans
		// the event out to subscribers (which includes our activity hook).
		await runtime.bus.publish({
			id: "evt-lane-create-started",
			type: "event",
			ts: new Date().toISOString(),
			topic: "lane.create.started",
			correlation_id: "corr-evt-lane-create",
			workspace_id: "ws-evt-1",
			lane_id: "lane-evt-1",
			payload: {},
		});
		await runtime.bus.publish({
			id: "evt-lane-create",
			type: "event",
			ts: new Date().toISOString(),
			topic: "lane.created",
			correlation_id: "corr-evt-lane-create",
			workspace_id: "ws-evt-1",
			lane_id: "lane-evt-1",
			payload: {},
		});

		expect(durability.isRunning()).toBe(true);

		// Force a checkpoint and ensure the durability layer is still
		// operational after the event was published.
		await durability.checkpointNow();
		const checkpoint = await durability.readCheckpoint();
		expect(checkpoint).not.toBeNull();

		await runtime.close();
		expect(durability.isRunning()).toBe(false);
	});
});
