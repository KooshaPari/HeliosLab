/**
 * FR-HELIOS-044: Workspace Store Tests
 * Verifies: FR-PER-001 (Workspace CRUD), FR-PER-002 (Unique workspace names), FR-PER-005 (Persistence)
 * Traces to: FR-MVP-011 (persist conversations), FR-MVP-013 (persist lane/session)
 */
import { describe, test, expect } from "bun:test";
import { createInMemoryStore } from "../../../src/workspace/store.js";
import type { Workspace } from "../../../src/workspace/types.js";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: `ws_${Math.random().toString(36).slice(2)}`,
    name: "Test",
    rootPath: "/tmp",
    state: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projects: [],
    ...overrides,
  };
}

describe("InMemoryWorkspaceStore", () => {
  test("save and getById", async () => {
    const store = createInMemoryStore();
    const ws = makeWorkspace();
    await store.save(ws);
    expect(await store.getById(ws.id)).toEqual(ws);
  });

  test("getById returns undefined for missing", async () => {
    const store = createInMemoryStore();
    expect(await store.getById("ws_nope")).toBeUndefined();
  });

  // FR-002
  test("getByName is case-insensitive", async () => {
    const store = createInMemoryStore();
    const ws = makeWorkspace({ name: "MyProject" });
    await store.save(ws);
    expect(await store.getByName("myproject")).toEqual(ws);
    expect(await store.getByName("MYPROJECT")).toEqual(ws);
  });

  test("getByName returns undefined for missing", async () => {
    const store = createInMemoryStore();
    expect(await store.getByName("ghost")).toBeUndefined();
  });

  test("getAll returns sorted by createdAt", async () => {
    const store = createInMemoryStore();
    const a = makeWorkspace({ name: "A", createdAt: 200 });
    const b = makeWorkspace({ name: "B", createdAt: 100 });
    await store.save(a);
    await store.save(b);
    const all = await store.getAll();
    expect(all[0]!.name).toBe("B");
    expect(all[1]!.name).toBe("A");
  });

  test("remove deletes workspace", async () => {
    const store = createInMemoryStore();
    const ws = makeWorkspace();
    await store.save(ws);
    await store.remove(ws.id);
    expect(await store.getById(ws.id)).toBeUndefined();
  });

  test("remove nonexistent is no-op", async () => {
    const store = createInMemoryStore();
    await store.remove("ws_nope"); // should not throw
  });

  test("save after remove re-adds", async () => {
    const store = createInMemoryStore();
    const ws = makeWorkspace();
    await store.save(ws);
    await store.remove(ws.id);
    await store.save(ws);
    expect(await store.getById(ws.id)).toEqual(ws);
  });

  test("flush is callable without error", async () => {
    const store = createInMemoryStore();
    await store.flush(); // no-op, should not throw
  });

  test("save upserts existing", async () => {
    const store = createInMemoryStore();
    const ws = makeWorkspace();
    await store.save(ws);
    const updated = { ...ws, name: "Updated" };
    await store.save(updated);
    expect((await store.getById(ws.id))!.name).toBe("Updated");
    expect(await store.getAll()).toHaveLength(1);
  });
});
