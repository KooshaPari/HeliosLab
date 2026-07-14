/**
 * FR-HELIOS-093: Workspace Persistence Integration Tests
 * Verifies: FR-PER-005 (Persist metadata), FR-PER-006 (Restore on restart), FR-PER-007 (Corruption detection)
 */
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";


import type { Workspace } from "../../../src/workspace/types.js";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: `ws_${Math.random().toString(36).slice(2)}`,
    name: "Test",
    rootPath: "/tmp/test",
    state: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projects: [],
    ...overrides,
  };
}

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "wp03-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("JSON persistence round-trip", () => {
  // FR-005
  test("save + reload preserves all data", async () => {
    const store = await createJsonStore(dataDir);
    const ws = makeWorkspace({ name: "Alpha" });
    await store.save(ws);

    // Create a new store from same dir
    const store2 = await createJsonStore(dataDir);
    const loaded = await store2.getById(ws.id);
    expect(loaded).toEqual(ws);
  });

  test("fresh install (no file) initializes empty", async () => {
    const store = await createJsonStore(dataDir);
    expect(await store.getAll()).toEqual([]);
  });

  test("multiple workspaces round-trip", async () => {
    const store = await createJsonStore(dataDir);
    const a = makeWorkspace({ name: "A" });
    const b = makeWorkspace({ name: "B" });
    await store.save(a);
    await store.save(b);

    const store2 = await createJsonStore(dataDir);
    const all = await store2.getAll();
    expect(all).toHaveLength(2);
  });

  test("workspace with Unicode name round-trips", async () => {
    const store = await createJsonStore(dataDir);
    const ws = makeWorkspace({
      name: "日本語ワークスペース 🚀",
      rootPath: "/tmp/日本語",
    });
    await store.save(ws);

    const store2 = await createJsonStore(dataDir);
    const loaded = await store2.getById(ws.id);
    expect(loaded?.name).toBe("日本語ワークスペース 🚀");
    expect(loaded?.rootPath).toBe("/tmp/日本語");
  });

  test("remove persists across restart", async () => {
    const store = await createJsonStore(dataDir);
    const ws = makeWorkspace();
    await store.save(ws);
    await store.remove(ws.id);

    const store2 = await createJsonStore(dataDir);
    expect(await store2.getById(ws.id)).toBeUndefined();
  });

  test("file deletion during runtime: next flush re-creates", async () => {
    const store = await createJsonStore(dataDir);
    const ws = makeWorkspace();
    await store.save(ws);

    // Delete the file
    await rm(join(dataDir, "workspaces.json"), { force: true });

    // Save another workspace — flush should re-create the file
    const ws2 = makeWorkspace({ name: "Two" });
    await store.save(ws2);

    const store2 = await createJsonStore(dataDir);
    expect(await store2.getAll()).toHaveLength(2);
  });
});

describe("Corruption recovery", () => {
  // FR-006, FR-007
  test("corrupted primary + valid snapshot recovers", async () => {
    const store = await createJsonStore(dataDir);
    const ws = makeWorkspace({ name: "Recover" });
    await store.save(ws); // creates primary + snapshot

    // Corrupt primary file
    await writeFile(join(dataDir, "workspaces.json"), "{ broken json!!");

    // New store should recover from snapshot
    const store2 = await createJsonStore(dataDir);
    const loaded = await store2.getById(ws.id);
    expect(loaded).toBeDefined();
    expect(loaded?.name).toBe("Recover");
  });

  test("corrupted primary + corrupted snapshot starts empty", async () => {
    const store = await createJsonStore(dataDir);
    const ws = makeWorkspace();
    await store.save(ws);

    // Corrupt both files
    await writeFile(join(dataDir, "workspaces.json"), "{ broken");
    await writeFile(join(dataDir, "workspaces.snapshot.json"), "{ also broken");

    const store2 = await createJsonStore(dataDir);
    expect(await store2.getAll()).toEqual([]);
  });

  test("empty primary file triggers recovery", async () => {
    const store = await createJsonStore(dataDir);
    const ws = makeWorkspace({ name: "Empty" });
    await store.save(ws);

    await writeFile(join(dataDir, "workspaces.json"), "");

    const store2 = await createJsonStore(dataDir);
    const loaded = await store2.getById(ws.id);
    expect(loaded?.name).toBe("Empty");
  });

  test("checksum mismatch triggers recovery", async () => {
    const store = await createJsonStore(dataDir);
    const ws = makeWorkspace({ name: "Checksum" });
    await store.save(ws);

    // Tamper with the primary file's checksum
    const raw = await readFile(join(dataDir, "workspaces.json"), "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    data["_checksum"] = "badhash";
    await writeFile(join(dataDir, "workspaces.json"), JSON.stringify(data));

    const store2 = await createJsonStore(dataDir);
    const loaded = await store2.getById(ws.id);
    expect(loaded?.name).toBe("Checksum");
  });

  test("both files missing (fresh install after wipe) starts empty", async () => {
    await rm(dataDir, { recursive: true, force: true });
    const store = await createJsonStore(dataDir);
    expect(await store.getAll()).toEqual([]);
  });
});

describe("Concurrent operations", () => {
  test("10 parallel saves produce consistent state", async () => {
    const store = await createJsonStore(dataDir);
    const workspaces = Array.from({ length: 10 }, (_, i) =>
      makeWorkspace({ name: `Concurrent-${i}` })
    );

    // FR-005: concurrent writes serialize correctly
    await Promise.all(workspaces.map(ws => store.save(ws)));

    const all = await store.getAll();
    expect(all).toHaveLength(10);

    // Verify persistence
    const store2 = await createJsonStore(dataDir);
    const all2 = await store2.getAll();
    expect(all2).toHaveLength(10);
  });

  test("concurrent save and remove are consistent", async () => {
    const store = await createJsonStore(dataDir);
    const ws = makeWorkspace({ name: "ConcRemove" });
    await store.save(ws);

    // Save + remove in parallel — final state depends on ordering but must not crash
    const ws2 = makeWorkspace({ name: "ConcNew" });
    await Promise.all([store.save(ws2), store.remove(ws.id)]);

    const all = await store.getAll();
    // ws should be removed, ws2 should exist
    expect(all.find(w => w.id === ws.id)).toBeUndefined();
    expect(all.find(w => w.id === ws2.id)).toBeDefined();
  });
});

describe("Storage size", () => {
  test("50 workspaces with 10 projects each under 1 MB", { timeout: 30000 }, async () => {
    const store = await createJsonStore(dataDir);
    for (let i = 0; i < 50; i++) {
      const ws = makeWorkspace({
        name: `Workspace-${i}`,
        rootPath: `/home/user/projects/workspace-${i}`,
        projects: Array.from({ length: 10 }, (_, j) => ({
          id: `proj_${i}_${j}`,
          workspaceId: `ws_${i}`,
          rootPath: `/home/user/projects/workspace-${i}/project-${j}`,
          gitUrl: `https://github.com/user/project-${j}.git`,
          status: "active" as const,
          boundAt: Date.now(),
        })),
      });
      await store.save(ws);
    }

    const raw = await readFile(join(dataDir, "workspaces.json"), "utf-8");
    expect(raw.length).toBeLessThan(1_000_000); // < 1 MB
  });
});
