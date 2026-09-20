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

	it("preserves the on-disk checkpoint across a simulated process restart", async () => {
		const dataDir = await makeTempDataDir();

		// First lifetime: register a lane + session, force a checkpoint,
		// then tear the runtime down. This is what a graceful shutdown
		// looks like — or, equivalently, what dies when the host process
		// is killed.
		const firstRuntime = createRuntime({ dataDir });
		await firstRuntime.bus.request({
			id: "cmd-lane-create-restart",
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: "ws-restart",
			correlation_id: "corr-restart-lane",
			method: "lane.create",
			payload: { id: "lane-restart" },
		});
		await firstRuntime.bus.request({
			id: "cmd-session-attach-restart",
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: "ws-restart",
			lane_id: "lane-restart",
			session_id: "session-restart",
			correlation_id: "corr-restart-session",
			method: "session.attach",
			payload: {
				id: "session-restart",
				lane_id: "lane-restart",
				codex_session_id: "codex-restart",
			},
		});

		const firstDurability = await firstRuntime.getDurability();
		await firstDurability.checkpointNow();
		const firstCheckpoint = await firstDurability.readCheckpoint();
		expect(firstCheckpoint).not.toBeNull();
		expect((firstCheckpoint?.sessions ?? []).map((s) => s.sessionId)).toContain(
			"session-restart",
		);
		await firstRuntime.close();

		// The on-disk checkpoint file must exist before we bring up a
		// second runtime — this is the "checkpoint survived the crash"
		// invariant.
		const checkpointPath = path.join(dataDir, "recovery", "checkpoint.json");
		const persisted = JSON.parse(await fs.readFile(checkpointPath, "utf-8"));
		expect(
			persisted.sessions.map((s: { sessionId: string }) => s.sessionId),
		).toContain("session-restart");
		const persistedVersion = persisted.version;

		// Second lifetime: a brand-new runtime pointing at the same
		// dataDir. This is what the OS hands us after the previous
		// process is reaped. Register a session in this runtime too so
		// the snapshotter has something to record on the next checkpoint.
		const secondRuntime = createRuntime({ dataDir });
		await secondRuntime.bus.request({
			id: "cmd-lane-create-restart-2",
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: "ws-restart",
			correlation_id: "corr-restart-lane-2",
			method: "lane.create",
			payload: { id: "lane-restart-2" },
		});
		await secondRuntime.bus.request({
			id: "cmd-session-attach-restart-2",
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: "ws-restart",
			lane_id: "lane-restart-2",
			session_id: "session-restart-2",
			correlation_id: "corr-restart-session-2",
			method: "session.attach",
			payload: {
				id: "session-restart-2",
				lane_id: "lane-restart-2",
				codex_session_id: "codex-restart-2",
			},
		});

		const secondDurability = await secondRuntime.getDurability();

		expect(secondDurability.getDataDir()).toBe(dataDir);

		const restored = await secondDurability.readCheckpoint();
		expect(restored).not.toBeNull();
		const restoredSessionIds = (restored?.sessions ?? []).map(
			(s) => s.sessionId,
		);
		expect(restoredSessionIds).toContain("session-restart");
		// Version is stable across lifetimes; timestamp is not, because
		// shutdown() triggers a final checkpoint with a fresh timestamp.
		expect(restored?.version).toBe(persistedVersion);

		// Second lifetime must also be able to write a fresh checkpoint
		// on top of the restored one.
		await secondDurability.checkpointNow();
		const refreshed = await secondDurability.readCheckpoint();
		expect(refreshed).not.toBeNull();
		expect((refreshed?.sessions ?? []).map((s) => s.sessionId)).toContain(
			"session-restart-2",
		);

		await secondRuntime.close();
	});
});
