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
 * not create a workspace at all.
 *
 * `path.posix` and `path.win32` are host-independent: each applies its own
 * platform's rules on every OS, so this accepts Windows paths on Linux and POSIX
 * paths on Windows. That is deliberate. A workspace root is authored by a person,
 * often on a different machine from the one reading it, and rejecting a valid
 * path because the host disagrees is the bug being fixed. The cost is that on
 * Linux a stored `C:\tmp` cannot be opened, but such a value can only arrive from
 * a user who typed one, and `bindLocalProject` still validates with the
 * host-dependent `isAbsolute` and so reports it as inaccessible at the point of
 * use rather than silently.
 */
function isAbsoluteRootPath(rootPath: string): boolean {
	return posix.isAbsolute(rootPath) || win32.isAbsolute(rootPath);
}

/**
 * Separators recognized by each flavour. `win32.sep` is only `\`, but win32
 * accepts `/` as a separator too, so stripping by `sep` alone would leave the
 * trailing slash on `C:/tmp/test/` and normalize two spellings of the same
 * directory to two different stored strings.
 */
const POSIX_SEPARATORS = "/";
const WIN32_SEPARATORS = "\\/";

/**
 * Strip trailing separators, but never below the path's own root.
 *
 * The root is taken from `parse` rather than matched with a hand-written regex,
 * which is what makes this correct for every root shape:
 *
 * - `/` stays `/` — the posix root is the whole string.
 * - `C:\`, `C:/` and `\\?\C:\` stay intact. Stripping would yield `C:` or
 *   `\\?\C:`, both drive-relative and naming a different location entirely.
 * - `\\server\share\` stays intact because win32 reports the UNC share root
 *   including its trailing separator.
 * - `/srv/weird\` keeps its trailing backslash. On POSIX a backslash is an
 *   ordinary filename character, so `/srv/weird\` can be a real directory whose
 *   last byte is `\`. A blanket `[\\/]+$` would rewrite that to `/srv/weird` and
 *   silently point the workspace somewhere else. Only separators belonging to
 *   the flavour that actually matches are stripped.
 */
function normalizeRootPath(rootPath: string): string {
	// A path reaching here is absolute under at least one flavour, so one of the
	// two parse roots is non-empty. Prefer posix when it matches, since posix
	// treats `\` as ordinary filename data and must not strip it.
	const usePosix = posix.isAbsolute(rootPath);
	const root = (usePosix ? posix : win32).parse(rootPath).root;
	const separators = usePosix ? POSIX_SEPARATORS : WIN32_SEPARATORS;
	if (rootPath.length <= root.length) return rootPath;
	let end = rootPath.length;
	// `root` is never empty for an absolute path, so the loop floor keeps `end` at
	// least 1 and the slice can never start before the root. `?? ""` is required by
	// `noUncheckedIndexedAccess`, and is inert: the floor guarantees the index is
	// in range, and "" is not a separator so it would stop the loop anyway.
	while (end > root.length && separators.includes(rootPath[end - 1] ?? "")) {
		end--;
	}
	return rootPath.slice(0, end);
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
