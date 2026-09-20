/**
 * Tests for the path-traversal guards in
 * {@link FileBackedCheckpointStore}. These cover the slice-3 review
 * threads that flagged unchecked `path.join(baseDir, sessionId)` /
 * `path.join(dir, checkpointId)` calls.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileBackedCheckpointStore } from "../../../src/sessions/checkpoint_store.js";

describe("FileBackedCheckpointStore path-traversal guards", () => {
	let tmpDir: string;
	let store: FileBackedCheckpointStore;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "helios-checkpoint-store-"),
		);
		store = new FileBackedCheckpointStore(tmpDir);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test("save rejects session_id containing ..", async () => {
		await expect(
			store.save({
				checkpoint_id: "cp-1",
				workspace_id: "ws-1",
				lane_id: "lane-1",
				session_id: "../etc",
				created_at: new Date().toISOString(),
				cursor: "c",
				payload: {},
			}),
		).rejects.toThrow(/SessionCheckpoint\.session_id/);
	});

	test("save rejects session_id containing slashes", async () => {
		await expect(
			store.save({
				checkpoint_id: "cp-1",
				workspace_id: "ws-1",
				lane_id: "lane-1",
				session_id: "session/with/slashes",
				created_at: new Date().toISOString(),
				cursor: "c",
				payload: {},
			}),
		).rejects.toThrow(/unsafe/);
	});

	test("save rejects checkpoint_id with unsafe characters", async () => {
		await expect(
			store.save({
				checkpoint_id: "cp/../../escape",
				workspace_id: "ws-1",
				lane_id: "lane-1",
				session_id: "session-1",
				created_at: new Date().toISOString(),
				cursor: "c",
				payload: {},
			}),
		).rejects.toThrow(/SessionCheckpoint\.checkpoint_id/);
	});

	test("list rejects session_id containing ..", async () => {
		await expect(store.list("../escape")).rejects.toThrow(/unsafe/);
	});

	test("list returns [] when the session directory does not exist", async () => {
		expect(await store.list("session-missing")).toEqual([]);
	});

	test("save + roundtrip: empty checkpoint_id is auto-generated", async () => {
		const createdAt = new Date().toISOString();
		await store.save({
			checkpoint_id: "",
			workspace_id: "ws-1",
			lane_id: "lane-1",
			session_id: "session-1",
			created_at: createdAt,
			cursor: "c",
			payload: { x: 1 },
		});
		const checkpoints = await store.list("session-1");
		expect(checkpoints.length).toBe(1);
		expect(checkpoints[0]?.checkpoint_id).not.toBe("");
		expect(checkpoints[0]?.checkpoint_id.length).toBeGreaterThan(0);
		expect(checkpoints[0]?.workspace_id).toBe("ws-1");
		expect(checkpoints[0]?.payload).toEqual({ x: 1 });
	});

	test("save + list roundtrip preserves payload", async () => {
		await store.save({
			checkpoint_id: "cp-1",
			workspace_id: "ws-1",
			lane_id: "lane-1",
			session_id: "session-1",
			created_at: "2026-01-01T00:00:00.000Z",
			cursor: "c-1",
			payload: { hello: "world" },
		});
		const list = await store.list("session-1");
		expect(list.length).toBe(1);
		expect(list[0]?.cursor).toBe("c-1");
		expect(list[0]?.payload).toEqual({ hello: "world" });
	});

	test("save + latest returns most recent by created_at", async () => {
		await store.save({
			checkpoint_id: "cp-1",
			workspace_id: "ws-1",
			lane_id: "lane-1",
			session_id: "session-1",
			created_at: "2026-01-01T00:00:00.000Z",
			cursor: "older",
			payload: {},
		});
		await store.save({
			checkpoint_id: "cp-2",
			workspace_id: "ws-1",
			lane_id: "lane-1",
			session_id: "session-1",
			created_at: "2026-01-02T00:00:00.000Z",
			cursor: "newer",
			payload: {},
		});
		const latest = await store.latest("session-1");
		expect(latest?.cursor).toBe("newer");
	});

	test("save auto-fills missing created_at", async () => {
		await store.save({
			checkpoint_id: "cp-1",
			workspace_id: "ws-1",
			lane_id: "lane-1",
			session_id: "session-1",
			created_at: "",
			cursor: "c",
			payload: {},
		});
		const list = await store.list("session-1");
		expect(list[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	test("write does not escape baseDir even on adversarial id", async () => {
		// Verify the rejection happens BEFORE any directory is created.
		const parentSentinel = path.join(tmpDir, "sentinel.txt");
		await fs.writeFile(parentSentinel, "should remain");
		await store
			.save({
				checkpoint_id: "cp-1",
				workspace_id: "ws-1",
				lane_id: "lane-1",
				session_id: "../../etc",
				created_at: new Date().toISOString(),
				cursor: "c",
				payload: {},
			})
			.catch(() => undefined);
		const sentinel = await fs.readFile(parentSentinel, "utf-8");
		expect(sentinel).toBe("should remain");
		// No session directory was created above the recovery root.
		const recoveryDir = path.join(tmpDir, "recovery");
		const entries = await fs.readdir(recoveryDir).catch(() => [] as string[]);
		expect(entries.some((e) => e.includes(".."))).toBe(false);
	});
});

describe("FileBackedCheckpointStore construction", () => {
	test("rejects missing dataDir", () => {
		expect(() => new FileBackedCheckpointStore("")).toThrow(/dataDir/);
	});

	test("rejects non-string dataDir", () => {
		expect(() => new FileBackedCheckpointStore(undefined as never)).toThrow(
			/dataDir/,
		);
	});
});
