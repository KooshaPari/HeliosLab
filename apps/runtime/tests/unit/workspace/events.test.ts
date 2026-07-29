/**
 * FR-HELIOS-037: Workspace Lifecycle Events Tests
 * Verifies: FR-PER-009 (Workspace lifecycle events: created, opened, closed, deleted)
 */

import { WorkspaceService } from "../../../src/workspace/workspace.js";
import { createInMemoryStore } from "../../../src/workspace/store.js";
import type { WorkspaceStore } from "../../../src/workspace/types.js";

let store: WorkspaceStore;
let events: Array<{ topic: string; payload: Record<string, unknown> }>;
let publishMock: (topic: string, payload: Record<string, unknown>) => void;

beforeEach(() => {
  store = createInMemoryStore();
  events = [];
  publishMock = (topic, payload) => {
    events.push({ topic, payload });
  };
});

describe("workspace lifecycle events", () => {
  test("create emits workspace.created", async () => {
    const svc = new WorkspaceService(store, undefined, publishMock);
    const ws = await svc.create({ name: "Test", rootPath: "/tmp/test" });
    expect(events).toHaveLength(1);
    expect(events[0]!.topic).toBe("workspace.created");
    expect(events[0]!.payload["workspaceId"]).toBe(ws.id);
    expect(events[0]!.payload["name"]).toBe("Test");
    expect(events[0]!.payload["rootPath"]).toBe("/tmp/test");
  });

  test("open emits workspace.opened", async () => {
    const svc = new WorkspaceService(store, undefined, publishMock);
    const ws = await svc.create({ name: "Test", rootPath: "/tmp/test" });
    events.length = 0;
    await svc.close(ws.id);
    events.length = 0;
    await svc.open(ws.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.topic).toBe("workspace.opened");
    expect(events[0]!.payload["workspaceId"]).toBe(ws.id);
  });

  test("close emits workspace.closed", async () => {
    const svc = new WorkspaceService(store, undefined, publishMock);
    const ws = await svc.create({ name: "Test", rootPath: "/tmp/test" });
    events.length = 0;
    await svc.close(ws.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.topic).toBe("workspace.closed");
    expect(events[0]!.payload["workspaceId"]).toBe(ws.id);
  });

  test("delete emits workspace.deleted", async () => {
    const svc = new WorkspaceService(store, undefined, publishMock);
    const ws = await svc.create({ name: "Test", rootPath: "/tmp/test" });
    events.length = 0;
    await svc.delete(ws.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.topic).toBe("workspace.deleted");
    expect(events[0]!.payload["workspaceId"]).toBe(ws.id);
  });
});

describe("bus error isolation", () => {
  test("sync bus error does not fail create", async () => {
    const throwingPublish = () => {
      throw new Error("bus exploded");
    };
    const svc = new WorkspaceService(store, undefined, throwingPublish);
    const ws = await svc.create({ name: "Test", rootPath: "/tmp/test" });
    expect(ws.name).toBe("Test");
  });

  test("async bus error does not fail create", async () => {
    const asyncThrowingPublish = async () => {
      throw new Error("async bus exploded");
    };
    const svc = new WorkspaceService(store, undefined, asyncThrowingPublish);
    const ws = await svc.create({ name: "Test", rootPath: "/tmp/test" });
    expect(ws.name).toBe("Test");
  });

  test("no bus provided works gracefully", async () => {
    const svc = new WorkspaceService(store);
    const ws = await svc.create({ name: "Test", rootPath: "/tmp/test" });
    expect(ws.name).toBe("Test");
  });

  test("CRUD succeeds even when bus throws on every operation", async () => {
    const throwingPublish = () => {
      throw new Error("always fails");
    };
    const svc = new WorkspaceService(store, undefined, throwingPublish);
    const ws = await svc.create({ name: "Lifecycle", rootPath: "/tmp/lc" });
    const closed = await svc.close(ws.id);
    expect(closed.state).toBe("closed");
    const opened = await svc.open(ws.id);
    expect(opened.state).toBe("active");
    await svc.delete(ws.id);
    expect(await svc.get(ws.id)).toBeUndefined();
  });
});
