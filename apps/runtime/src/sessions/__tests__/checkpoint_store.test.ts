import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	FileBackedCheckpointStore,
	type SessionCheckpoint,
} from "../checkpoint_store.js";

function mkCheckpoint(
	overrides: Partial<SessionCheckpoint>,
): SessionCheckpoint {
	return {
		checkpoint_id: "ck-1",
		workspace_id: "ws-A",
		lane_id: "lane-1",
		session_id: "sess-1",
		created_at: "2026-01-01T00:00:00.000Z",
		cursor: "cursor-1",
		payload: {},
		...overrides,
	};
}

describe("FileBackedCheckpointStore", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "checkpoint-store-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("constructor rejects empty or non-string dataDir", () => {
		expect(() => new FileBackedCheckpointStore("")).toThrow();
		expect(
			() => new FileBackedCheckpointStore(undefined as unknown as string),
		).toThrow();
	});

	it("latest returns null when session has no checkpoints", async () => {
		const store = new FileBackedCheckpointStore(dir);
		expect(await store.latest("sess-x")).toBeNull();
		expect(await store.list("sess-x")).toEqual([]);
	});

	it("save then latest returns the same checkpoint", async () => {
		const store = new FileBackedCheckpointStore(dir);
		const cp = mkCheckpoint({ checkpoint_id: "ck-A" });
		await store.save(cp);
		const out = await store.latest("sess-1");
		expect(out).not.toBeNull();
		expect(out?.checkpoint_id).toBe("ck-A");
		expect(out?.session_id).toBe("sess-1");
		expect(out?.cursor).toBe("cursor-1");
	});

	it("latest picks the checkpoint with the most recent created_at", async () => {
		const store = new FileBackedCheckpointStore(dir);
		await store.save(
			mkCheckpoint({
				checkpoint_id: "old",
				created_at: "2026-01-01T00:00:00.000Z",
			}),
		);
		await store.save(
			mkCheckpoint({
				checkpoint_id: "new",
				created_at: "2026-03-01T00:00:00.000Z",
			}),
		);
		await store.save(
			mkCheckpoint({
				checkpoint_id: "mid",
				created_at: "2026-02-01T00:00:00.000Z",
			}),
		);
		const latest = await store.latest("sess-1");
		expect(latest?.checkpoint_id).toBe("new");
	});

	it("list returns checkpoints sorted by created_at asc", async () => {
		const store = new FileBackedCheckpointStore(dir);
		await store.save(
			mkCheckpoint({
				checkpoint_id: "c3",
				created_at: "2026-03-01T00:00:00.000Z",
			}),
		);
		await store.save(
			mkCheckpoint({
				checkpoint_id: "c1",
				created_at: "2026-01-01T00:00:00.000Z",
			}),
		);
		await store.save(
			mkCheckpoint({
				checkpoint_id: "c2",
				created_at: "2026-02-01T00:00:00.000Z",
			}),
		);
		const list = await store.list("sess-1");
		expect(list.map((c) => c.checkpoint_id)).toEqual(["c1", "c2", "c3"]);
	});

	it("scopes by session_id — sessions do not share checkpoints", async () => {
		const store = new FileBackedCheckpointStore(dir);
		await store.save(
			mkCheckpoint({ session_id: "sess-1", checkpoint_id: "a" }),
		);
		await store.save(
			mkCheckpoint({ session_id: "sess-2", checkpoint_id: "b" }),
		);
		const s1 = await store.list("sess-1");
		const s2 = await store.list("sess-2");
		expect(s1.map((c) => c.checkpoint_id)).toEqual(["a"]);
		expect(s2.map((c) => c.checkpoint_id)).toEqual(["b"]);
	});

	it("save assigns a generated checkpoint_id when caller omits one", async () => {
		const store = new FileBackedCheckpointStore(dir);
		await store.save(mkCheckpoint({ checkpoint_id: "" }));
		const list = await store.list("sess-1");
		expect(list).toHaveLength(1);
		expect(list[0]?.checkpoint_id).toBeString();
		expect(list[0]?.checkpoint_id?.length).toBeGreaterThan(0);
	});

	it("save assigns a default created_at when caller omits one", async () => {
		const store = new FileBackedCheckpointStore(dir);
		await store.save(mkCheckpoint({ created_at: "" }));
		const list = await store.list("sess-1");
		expect(list[0]?.created_at).toBeString();
		expect(list[0]?.created_at?.length).toBeGreaterThan(0);
	});

	it("save rejects checkpoints without session_id", async () => {
		const store = new FileBackedCheckpointStore(dir);
		await expect(store.save(mkCheckpoint({ session_id: "" }))).rejects.toThrow(
			/session_id/i,
		);
	});

	it("survives a fresh store reading checkpoints written by another instance", async () => {
		const writer = new FileBackedCheckpointStore(dir);
		await writer.save(mkCheckpoint({ checkpoint_id: "persisted" }));
		const reader = new FileBackedCheckpointStore(dir);
		const latest = await reader.latest("sess-1");
		expect(latest?.checkpoint_id).toBe("persisted");
	});
});
