import { describe, expect, it } from "bun:test";
import {
	DuplicateBindingError,
	PaneNotFoundError,
	PaneTooSmallError,
	PtyBindingError,
	SessionAlreadyExistsError,
	SessionNotFoundError,
	TabNotFoundError,
	ZellijCliError,
	ZellijNotFoundError,
	ZellijTimeoutError,
	ZellijVersionError,
} from "../../../../src/integrations/zellij/errors";

describe("zellij error types", () => {
	it("ZellijNotFoundError carries install guidance", () => {
		const e = new ZellijNotFoundError();
		expect(e.name).toBe("ZellijNotFoundError");
		expect(e.message).toMatch(/not found in PATH/);
		expect(e.message).toMatch(/zellij\.dev/);
	});

	it("ZellijVersionError reports actual and required", () => {
		const e = new ZellijVersionError("0.38.0", "0.39.0");
		expect(e.name).toBe("ZellijVersionError");
		expect(e.message).toContain("0.38.0");
		expect(e.message).toContain("0.39.0");
	});

	it("ZellijCliError exposes command, exit code, and stderr", () => {
		const e = new ZellijCliError("zellij ls", 2, "boom");
		expect(e.name).toBe("ZellijCliError");
		expect(e.exitCode).toBe(2);
		expect(e.stderr).toBe("boom");
		expect(e.message).toContain("zellij ls");
	});

	it("ZellijTimeoutError reports the timeout", () => {
		const e = new ZellijTimeoutError("zellij attach", 5000);
		expect(e.name).toBe("ZellijTimeoutError");
		expect(e.message).toContain("5000ms");
	});

	it("session errors name the session", () => {
		const missing = new SessionNotFoundError("work");
		expect(missing.name).toBe("SessionNotFoundError");
		expect(missing.message).toContain("work");
		const dup = new SessionAlreadyExistsError("work");
		expect(dup.name).toBe("SessionAlreadyExistsError");
		expect(dup.message).toContain("work");
	});

	it("DuplicateBindingError names key and existing binding", () => {
		const e = new DuplicateBindingError("ctrl-t", "spawn");
		expect(e.name).toBe("DuplicateBindingError");
		expect(e.message).toContain("ctrl-t");
		expect(e.message).toContain("spawn");
	});

	it("PaneTooSmallError records requested and minimum dimensions", () => {
		const e = new PaneTooSmallError(10, 5, 20, 10);
		expect(e.requestedCols).toBe(10);
		expect(e.requestedRows).toBe(5);
		expect(e.minCols).toBe(20);
		expect(e.minRows).toBe(10);
		expect(e.message).toContain("10x5");
		expect(e.message).toContain("20x10");
	});

	it("lookup errors name session and id", () => {
		const pane = new PaneNotFoundError("work", 3);
		expect(pane.name).toBe("PaneNotFoundError");
		expect(pane.message).toContain("3");
		const tab = new TabNotFoundError("work", 4);
		expect(tab.name).toBe("TabNotFoundError");
		expect(tab.message).toContain("4");
	});

	it("PtyBindingError gives pane and reason", () => {
		const e = new PtyBindingError(9, "pty closed");
		expect(e.name).toBe("PtyBindingError");
		expect(e.message).toContain("9");
		expect(e.message).toContain("pty closed");
	});
});
