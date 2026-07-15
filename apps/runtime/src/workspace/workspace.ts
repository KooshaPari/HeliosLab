// T002 & T004 — Workspace entity functions and service
// T009 — Bus event emission for workspace lifecycle

import type { CreateWorkspaceInput, Workspace, WorkspaceStore } from "./types.js";
import { detectStaleProjects } from "./project.js";
import { generateId } from "@helios/ids";
import { isAbsolute, parse } from "node:path";
import { randomUUID } from "node:crypto";
import type { LocalBus } from "../protocol/bus.js";

function generateWorkspaceId(): string {
  return generateId("workspace");
}

function normalizeRootPath(rootPath: string): string {
  const root = parse(rootPath).root;
  let normalized = rootPath;
  while (normalized.length > root.length && /[\\/]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** Bus publish function signature */
export type BusPublishFn = (
  topic: string,
  payload: Record<string, unknown>
) => void | Promise<void>;

/** Adapt the protocol bus to the workspace service's narrow publisher contract. */
export function createWorkspaceBusPublisher(bus: LocalBus): BusPublishFn {
  return (topic, payload) =>
    bus.publish({
      id: randomUUID(),
      type: "event",
      ts: new Date().toISOString(),
      topic,
      payload,
    });
}

// ── Entity functions (immutable state transitions) ──────────────────

export function createWorkspace(input: CreateWorkspaceInput): Workspace {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("Workspace name must not be empty");
  }
  if (!isAbsolute(input.rootPath)) {
    throw new Error("Workspace rootPath must be absolute");
  }
  const now = Date.now();
  return {
    id: generateWorkspaceId(),
    name,
    rootPath: normalizeRootPath(input.rootPath),
    state: "active",
    createdAt: now,
    updatedAt: now,
    projects: [],
  };
}

export function openWorkspace(ws: Workspace): Workspace {
  if (ws.state !== "closed") {
    throw new Error(`Cannot open workspace in '${ws.state}' state; must be 'closed'`);
  }
  return { ...ws, state: "active", updatedAt: Date.now() };
}

export function closeWorkspace(ws: Workspace): Workspace {
  if (ws.state !== "active") {
    throw new Error(`Cannot close workspace in '${ws.state}' state; must be 'active'`);
  }
  return { ...ws, state: "closed", updatedAt: Date.now() };
}

export function deleteWorkspace(ws: Workspace, activeSessionCount: number): Workspace {
  if (activeSessionCount > 0) {
    throw new Error("Cannot delete workspace with active sessions; close sessions first");
  }
  if (ws.state === "deleted") {
    throw new Error("Workspace is already deleted");
  }
  return { ...ws, state: "deleted", updatedAt: Date.now() };
}

// ── Service layer (CRUD + uniqueness + persistence + bus events) ─────

export class WorkspaceService {
  private readonly store: WorkspaceStore;
  private readonly sessionCountQuery: (workspaceId: string) => Promise<number>;
  private readonly publish: BusPublishFn | undefined;

  constructor(
    store: WorkspaceStore,
    sessionCountQuery?: (workspaceId: string) => Promise<number>,
    publish?: BusPublishFn
  ) {
    this.store = store;
    this.sessionCountQuery = sessionCountQuery ?? (() => Promise.resolve(0));
    this.publish = publish;
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const existing = await this.store.getByName(input.name.trim());
    if (existing !== undefined) {
      throw new Error(`Workspace with name '${input.name.trim()}' already exists`);
    }
    const ws = createWorkspace(input);
    await this.store.save(ws);
    await this.emitEvent("workspace.created", {
      workspaceId: ws.id,
      name: ws.name,
      rootPath: ws.rootPath,
    });
    return ws;
  }

  async open(id: string): Promise<Workspace> {
    const ws = await this.requireById(id);
    let opened = openWorkspace(ws);
    // T007 — detect stale projects on workspace open
    try {
      opened = await detectStaleProjects(opened);
    } catch {
      // Stale detection must not block workspace open
    }
    await this.store.save(opened);
    await this.emitEvent("workspace.opened", { workspaceId: opened.id });
    return opened;
  }

  async close(id: string): Promise<Workspace> {
    const ws = await this.requireById(id);
    const closed = closeWorkspace(ws);
    await this.store.save(closed);
    await this.emitEvent("workspace.closed", { workspaceId: closed.id });
    return closed;
  }

  async delete(id: string): Promise<void> {
    const ws = await this.requireById(id);
    const count = await this.sessionCountQuery(id);
    const deleted = deleteWorkspace(ws, count);
    // Mark deleted in store then remove
    await this.store.save(deleted);
    await this.store.remove(id);
    await this.emitEvent("workspace.deleted", { workspaceId: id });
  }

  async list(): Promise<Workspace[]> {
    return this.store.getAll();
  }

  async get(id: string): Promise<Workspace | undefined> {
    return this.store.getById(id);
  }

  private async requireById(id: string): Promise<Workspace> {
    const ws = await this.store.getById(id);
    if (ws === undefined) {
      throw new Error(`Workspace '${id}' not found`);
    }
    return ws;
  }

  /** Publish a lifecycle event without allowing bus failures to fail the operation. */
  private async emitEvent(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (this.publish == null) return;
    try {
      await this.publish(topic, payload);
    } catch {
      // Bus errors are silently swallowed
    }
  }
}
