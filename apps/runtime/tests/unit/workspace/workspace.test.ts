// T005 — Workspace CRUD lifecycle tests
// FR-001: Workspace CRUD lifecycle
// FR-002: Unique workspace names
// FR-008: Deletion guard with active sessions
// Traces to: FR-PER-001 (workspace CRUD), FR-PER-002 (unique names), FR-PER-003 (project binding),
// FR-PER-004 (validate paths), FR-PER-005 (persist metadata), FR-PER-006 (restore on startup),
// FR-PER-009 (workspace lifecycle events), FR-PER-010 (assign workspace_id),
// FR-MVP-011 (persist conversations/state), FR-MVP-013 (persist lane/session)

import { describe, expect, test } from "bun:test";
import { posix, win32 } from "node:path";
import { createInMemoryStore } from "../../../src/workspace/store.js";
import {
	closeWorkspace,
	createWorkspace,
	deleteWorkspace,
	openWorkspace,
	WorkspaceService,
} from "../../../src/workspace/workspace.js";

// ── Entity function tests ───────────────────────────────────────────

describe("createWorkspace", () => {
	// FR-001
	test("creates workspace with active state", () => {
		const ws = createWorkspace({ name: "Test", rootPath: "/tmp/test" });
		expect(ws.state).toBe("active");
		expect(ws.name).toBe("Test");
		expect(ws.rootPath).toBe("/tmp/test");
		expect(ws.id).toMatch(/^ws_/);
		expect(ws.projects).toEqual([]);
	});

	test("rejects empty name", () => {
		expect(() => createWorkspace({ name: "", rootPath: "/tmp" })).toThrow(
			"must not be empty",
		);
	});

	test("rejects whitespace-only name", () => {
		expect(() => createWorkspace({ name: "   ", rootPath: "/tmp" })).toThrow(
			"must not be empty",
		);
	});

	test("rejects relative root path", () => {
		expect(() =>
			createWorkspace({ name: "Test", rootPath: "relative/path" }),
		).toThrow("must be absolute");
	});

	test("normalizes trailing slash", () => {
		const ws = createWorkspace({ name: "Test", rootPath: "/tmp/test/" });
		expect(ws.rootPath).toBe("/tmp/test");
	});

	test("keeps root slash as-is", () => {
		const ws = createWorkspace({ name: "Test", rootPath: "/" });
		expect(ws.rootPath).toBe("/");
	});

	test("accepts very long name", () => {
		const longName = "x".repeat(1000);
		const ws = createWorkspace({ name: longName, rootPath: "/tmp" });
		expect(ws.name).toBe(longName);
	});
});

// Issue #228 — createWorkspace rejected every native Windows path because the
// guard was `rootPath.startsWith("/")`. Windows users could not create a
// workspace at all. These cases pin the fixed behaviour on both platforms, so
// the suite is meaningful on Linux CI and on a Windows developer machine.
describe("createWorkspace root path portability (#228)", () => {
	// [input, expected stored rootPath].
	//
	// These are literal expected values, not a re-assertion of the guard's own
	// predicate. A table that re-checks `isAbsolute(input)` only proves
	// normalization did not destroy the path shape; it still passes if the guard
	// becomes too strict or too lax in ways that change which inputs reach
	// normalization at all. This table pins the exact stored string.
	const exact: [string, string][] = [
		// POSIX: trailing slash stripped, root preserved.
		["/tmp/test", "/tmp/test"],
		["/tmp/test/", "/tmp/test"],
		["/", "/"],
		["//", "/"],
		// A backslash is ordinary filename data on POSIX, so it is preserved
		// rather than treated as a separator. `/srv/weird\` can be a real
		// directory whose last byte is `\`; stripping it would silently point
		// the workspace at a different location.
		["/srv/weird\\", "/srv/weird\\"],
		// Windows drive paths: both separator styles, either case of drive letter.
		["C:\\tmp\\test", "C:\\tmp\\test"],
		["C:\\tmp\\test\\", "C:\\tmp\\test"],
		["C:/tmp/test", "C:/tmp/test"],
		["C:/tmp/test/", "C:/tmp/test"],
		["c:/tmp/test", "c:/tmp/test"],
		["C:\\Users\\dev\\repo", "C:\\Users\\dev\\repo"],
		// Drive roots keep their separator. `C:` is drive-relative and names a
		// different place entirely, so stripping the root is a correctness bug.
		["C:\\", "C:\\"],
		["C:/", "C:/"],
		["c:\\", "c:\\"],
		// UNC shares: the share root includes its trailing separator in
		// `win32.parse`, so `\\server\share\` is preserved like `C:\` is. Both
		// spellings open the same share, and each is independently absolute.
		["\\\\server\\share", "\\\\server\\share"],
		["\\\\server\\share\\", "\\\\server\\share\\"],
		["\\\\server\\share\\dir", "\\\\server\\share\\dir"],
		["\\\\server\\share\\dir\\", "\\\\server\\share\\dir"],
		// Extended-length roots keep their separator for the same reason as a
		// drive root. Windows documents that `\\?\` cannot be combined with a
		// relative path, so `\\?\C:` is not usable after normalization.
		["\\\\?\\C:\\", "\\\\?\\C:\\"],
		["\\\\?\\C:\\dir", "\\\\?\\C:\\dir"],
		["\\\\?\\C:\\dir\\", "\\\\?\\C:\\dir"],
		["\\\\?\\UNC\\server\\share\\", "\\\\?\\UNC\\server\\share"],
		// Device namespace roots behave identically.
		["\\\\.\\C:\\", "\\\\.\\C:\\"],
		["\\\\.\\C:\\dir\\", "\\\\.\\C:\\dir"],
	];

	for (const [input, expected] of exact) {
		test(`normalizes ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
			expect(createWorkspace({ name: "N", rootPath: input }).rootPath).toBe(
				expected,
			);
		});
	}

	// Every accepted root must remain absolute under both flavours, whatever the
	// host, so the table above stays honest if the guard is later changed.
	for (const rootPath of exact.map(([input]) => input)) {
		test(`${JSON.stringify(rootPath)} stays absolute after normalization`, () => {
			const ws = createWorkspace({ name: "A", rootPath });
			expect(
				posix.isAbsolute(ws.rootPath) || win32.isAbsolute(ws.rootPath),
			).toBe(true);
		});
	}

	// Paths that are absolute on neither platform stay rejected. `C:tmp` means
	// "tmp relative to the current directory on drive C", which is the one
	// Windows-shaped input that is genuinely not an absolute location.
	//
	// Note what is deliberately absent: `//server/share` and a lone leading `\`
	// are both absolute (`//` is a POSIX root, `\` is drive-rooted on Windows),
	// so they belong in the table above, not in this list.
	for (const rootPath of [
		"C:tmp",
		"C:",
		"relative/path",
		"",
		" ",
		"./abs",
		"../up",
	]) {
		test(`still rejects relative ${JSON.stringify(rootPath)}`, () => {
			expect(() => createWorkspace({ name: "R", rootPath })).toThrow(
				"must be absolute",
			);
		});
	}
});

describe("state transitions", () => {
	const base = createWorkspace({ name: "T", rootPath: "/tmp" });

	test("close active workspace", () => {
		const closed = closeWorkspace(base);
		expect(closed.state).toBe("closed");
		expect(closed).not.toBe(base); // immutable
	});

	test("open closed workspace", () => {
		const closed = closeWorkspace(base);
		const opened = openWorkspace(closed);
		expect(opened.state).toBe("active");
		expect(opened).not.toBe(closed);
	});

	test("cannot open active workspace", () => {
		expect(() => openWorkspace(base)).toThrow("must be 'closed'");
	});

	test("cannot close closed workspace", () => {
		const closed = closeWorkspace(base);
		expect(() => closeWorkspace(closed)).toThrow("must be 'active'");
	});

	test("cannot open deleted workspace", () => {
		const deleted = deleteWorkspace(base, 0);
		expect(() => openWorkspace(deleted)).toThrow("must be 'closed'");
	});

	// FR-008
	test("cannot delete with active sessions", () => {
		expect(() => deleteWorkspace(base, 1)).toThrow("close sessions first");
	});

	test("delete with zero sessions succeeds", () => {
		const deleted = deleteWorkspace(base, 0);
		expect(deleted.state).toBe("deleted");
	});

	test("cannot delete already deleted workspace", () => {
		const deleted = deleteWorkspace(base, 0);
		expect(() => deleteWorkspace(deleted, 0)).toThrow("already deleted");
	});
});

// ── Service tests ───────────────────────────────────────────────────

describe("WorkspaceService", () => {
	// FR-001
	test("full lifecycle: create → close → open → close → delete", async () => {
		const svc = new WorkspaceService(createInMemoryStore());
		const ws = await svc.create({ name: "Demo", rootPath: "/tmp/demo" });
		expect(ws.state).toBe("active");

		const closed = await svc.close(ws.id);
		expect(closed.state).toBe("closed");

		const reopened = await svc.open(ws.id);
		expect(reopened.state).toBe("active");

		const closed2 = await svc.close(ws.id);
		expect(closed2.state).toBe("closed");

		await svc.delete(ws.id);
		expect(await svc.get(ws.id)).toBeUndefined();
	});

	// FR-002
	test("rejects duplicate name", async () => {
		const svc = new WorkspaceService(createInMemoryStore());
		await svc.create({ name: "Unique", rootPath: "/tmp/a" });
		await expect(
			svc.create({ name: "Unique", rootPath: "/tmp/b" }),
		).rejects.toThrow("already exists");
	});

	// FR-002 case-insensitive
	test("rejects duplicate name case-insensitively", async () => {
		const svc = new WorkspaceService(createInMemoryStore());
		await svc.create({ name: "MyProject", rootPath: "/tmp/a" });
		await expect(
			svc.create({ name: "myproject", rootPath: "/tmp/b" }),
		).rejects.toThrow("already exists");
	});

	test("open nonexistent throws", async () => {
		const svc = new WorkspaceService(createInMemoryStore());
		await expect(svc.open("ws_fake")).rejects.toThrow("not found");
	});

	// FR-008
	test("delete with active sessions throws", async () => {
		const svc = new WorkspaceService(createInMemoryStore(), () =>
			Promise.resolve(1),
		);
		const ws = await svc.create({ name: "Busy", rootPath: "/tmp/busy" });
		await expect(svc.delete(ws.id)).rejects.toThrow("close sessions first");
	});

	test("list returns workspaces", async () => {
		const svc = new WorkspaceService(createInMemoryStore());
		await svc.create({ name: "A", rootPath: "/tmp/a" });
		await svc.create({ name: "B", rootPath: "/tmp/b" });
		const list = await svc.list();
		expect(list).toHaveLength(2);
	});

	test("delete then recreate same name succeeds", async () => {
		const svc = new WorkspaceService(createInMemoryStore());
		const ws = await svc.create({ name: "Reuse", rootPath: "/tmp/r" });
		await svc.delete(ws.id);
		const ws2 = await svc.create({ name: "Reuse", rootPath: "/tmp/r2" });
		expect(ws2.name).toBe("Reuse");
	});
});
