// T002 & T004 — Workspace entity functions and service
// T009 — Bus event emission for workspace lifecycle

import { posix, win32 } from "node:path";
import { detectStaleProjects } from "./project.js";
import type {
	CreateWorkspaceInput,
	Workspace,
	WorkspaceStore,
} from "./types.js";

// Stub ID generator — uses spec 005 format ws_{ulid}
function generateWorkspaceId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return `ws_${timestamp}${random}`;
}

/**
 * A root path is absolute if either platform's rules accept it.
 *
 * `startsWith("/")` was the previous check and it rejected every native Windows
 * path — `C:\tmp`, `C:\tmp\`, `C:/tmp`, `\\server\share` — so Windows users could
 * not create a workspace at all. `node:path` always resolves to one platform's
 * rules, so both are checked: on Linux a pasted `C:\tmp` is genuinely relative
 * and stays rejected, and on Windows a pasted `/tmp` is genuinely absolute and
 * is accepted. Drive letters and UNC roots are matched explicitly because
 * `path.isAbsolute` alone is host-dependent and cannot satisfy both.
 */
function isAbsoluteRootPath(rootPath: string): boolean {
	if (posix.isAbsolute(rootPath) || win32.isAbsolute(rootPath)) {
		return true;
	}
	// Drive-rooted: `C:\` or `C:/`. `win32.isAbsolute` already covers these on
	// Windows; this keeps them valid when a Windows path is validated on Linux,
	// where win32.isAbsolute reports false because posix wins for `/`-less input.
	return /^[A-Za-z]:[\\/]/.test(rootPath);
}

function normalizeRootPath(rootPath: string): string {
	if (rootPath.length <= 1) return rootPath;
	if (/^[A-Za-z]:[\\/]+$/.test(rootPath)) {
		// Drive root `C:\` and `C:/` are filesystem roots, not a trailing slash
		// on a named directory. Stripping it would yield `C:`, which is a
		// drive-relative path and means something entirely different.
		return rootPath;
	}
	const trimmed = rootPath.replace(/[\\/]+$/, "");
	// Only strip if something remains, so `/` and `\\` are never emptied.
	return trimmed.length === 0 ? rootPath : trimmed;
}

/** Bus publish function signature */
export type BusPublishFn = (
	topic: string,
	payload: Record<string, unknown>,
) => void | Promise<void>;

// ── Entity functions (immutable state transitions) ──────────────────

export function createWorkspace(input: CreateWorkspaceInput): Workspace {
	const name = input.name.trim();
	if (name.length === 0) {
		throw new Error("Workspace name must not be empty");
	}
	if (!isAbsoluteRootPath(input.rootPath)) {
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
		throw new Error(
			`Cannot open workspace in '${ws.state}' state; must be 'closed'`,
		);
	}
	return { ...ws, state: "active", updatedAt: Date.now() };
}

export function closeWorkspace(ws: Workspace): Workspace {
	if (ws.state !== "active") {
		throw new Error(
			`Cannot close workspace in '${ws.state}' state; must be 'active'`,
		);
	}
	return { ...ws, state: "closed", updatedAt: Date.now() };
}

export function deleteWorkspace(
	ws: Workspace,
	activeSessionCount: number,
): Workspace {
	if (activeSessionCount > 0) {
		throw new Error(
			"Cannot delete workspace with active sessions; close sessions first",
		);
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
		publish?: BusPublishFn,
	) {
		this.store = store;
		this.sessionCountQuery = sessionCountQuery ?? (() => Promise.resolve(0));
		this.publish = publish;
	}

	async create(input: CreateWorkspaceInput): Promise<Workspace> {
		const existing = await this.store.getByName(input.name.trim());
		if (existing !== undefined) {
			throw new Error(
				`Workspace with name '${input.name.trim()}' already exists`,
			);
		}
		const ws = createWorkspace(input);
		await this.store.save(ws);
		this.emitEvent("workspace.created", {
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
		this.emitEvent("workspace.opened", { workspaceId: opened.id });
		return opened;
	}

	async close(id: string): Promise<Workspace> {
		const ws = await this.requireById(id);
		const closed = closeWorkspace(ws);
		await this.store.save(closed);
		this.emitEvent("workspace.closed", { workspaceId: closed.id });
		return closed;
	}

	async delete(id: string): Promise<void> {
		const ws = await this.requireById(id);
		const count = await this.sessionCountQuery(id);
		const deleted = deleteWorkspace(ws, count);
		// Mark deleted in store then remove
		await this.store.save(deleted);
		await this.store.remove(id);
		this.emitEvent("workspace.deleted", { workspaceId: id });
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

	/** Fire-and-forget bus event. Never fails the calling operation. */
	private emitEvent(topic: string, payload: Record<string, unknown>): void {
		if (this.publish == null) return;
		try {
			// Fire and forget — catch sync throws and promise rejections
			const result = this.publish(topic, payload);
			if (result instanceof Promise) {
				result.catch(() => {
					// Bus errors are silently swallowed
				});
			}
		} catch {
			// Bus errors are silently swallowed
		}
	}
}
