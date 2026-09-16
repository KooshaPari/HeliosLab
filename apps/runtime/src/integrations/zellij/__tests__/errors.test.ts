import { describe, expect, it } from "bun:test";
import {
	DuplicateBindingError,
	SessionAlreadyExistsError,
	SessionNotFoundError,
	ZellijCliError,
	ZellijNotFoundError,
	ZellijTimeoutError,
	ZellijVersionError,
} from "../errors.js";

/**
 * Unit tests for custom error classes.
 *
 * Verifies error construction, properties, and message formatting.
 */

describe("ZellijNotFoundError", () => {
	it("creates error with correct name and message", () => {
		const error = new ZellijNotFoundError();

		expect(error.name).toBe("ZellijNotFoundError");
		expect(error.message).toContain("zellij binary not found");
		expect(error.message).toContain(
			"https://zellij.dev/documentation/installation",
		);
		expect(error).toBeInstanceOf(Error);
	});
});

describe("ZellijVersionError", () => {
	it("creates error with version information", () => {
		const error = new ZellijVersionError("0.39.0", "0.40.0");

		expect(error.name).toBe("ZellijVersionError");
		expect(error.message).toContain("0.39.0");
		expect(error.message).toContain("0.40.0");
		expect(error.message).toContain("below the minimum required");
		expect(error).toBeInstanceOf(Error);
	});

	it("handles different version formats", () => {
		const error = new ZellijVersionError("1.2.3", "2.0.0");

		expect(error.message).toContain("1.2.3");
		expect(error.message).toContain("2.0.0");
	});
});

describe("ZellijCliError", () => {
	it("creates error with command, exit code, and stderr", () => {
		const error = new ZellijCliError("list-sessions", 1, "error output");

		expect(error.name).toBe("ZellijCliError");
		expect(error.exitCode).toBe(1);
		expect(error.stderr).toBe("error output");
		expect(error.message).toContain("list-sessions");
		expect(error.message).toContain("exit 1");
		expect(error.message).toContain("error output");
		expect(error).toBeInstanceOf(Error);
	});

	it("handles empty stderr", () => {
		const error = new ZellijCliError("test-command", 127, "");

		expect(error.exitCode).toBe(127);
		expect(error.stderr).toBe("");
	});

	it("preserves exitCode as public property", () => {
		const error = new ZellijCliError("cmd", 42, "stderr");

		// Should be accessible as a public property
		expect(error.exitCode).toBe(42);
	});
});

describe("ZellijTimeoutError", () => {
	it("creates error with command and timeout", () => {
		const error = new ZellijTimeoutError("long-running-command", 5000);

		expect(error.name).toBe("ZellijTimeoutError");
		expect(error.message).toContain("timed out");
		expect(error.message).toContain("5000ms");
		expect(error.message).toContain("long-running-command");
		expect(error).toBeInstanceOf(Error);
	});

	it("handles various timeout values", () => {
		const error1 = new ZellijTimeoutError("cmd", 1000);
		const error2 = new ZellijTimeoutError("cmd", 60000);

		expect(error1.message).toContain("1000ms");
		expect(error2.message).toContain("60000ms");
	});
});

describe("SessionNotFoundError", () => {
	it("creates error with session name", () => {
		const error = new SessionNotFoundError("my-session");

		expect(error.name).toBe("SessionNotFoundError");
		expect(error.message).toContain("not found");
		expect(error.message).toContain("my-session");
		expect(error).toBeInstanceOf(Error);
	});

	it("handles special characters in session name", () => {
		const error = new SessionNotFoundError(
			"session-with-dashes_and_underscores",
		);

		expect(error.message).toContain("session-with-dashes_and_underscores");
	});
});

describe("SessionAlreadyExistsError", () => {
	it("creates error with session name", () => {
		const error = new SessionAlreadyExistsError("existing-session");

		expect(error.name).toBe("SessionAlreadyExistsError");
		expect(error.message).toContain("already exists");
		expect(error.message).toContain("existing-session");
		expect(error).toBeInstanceOf(Error);
	});
});

describe("DuplicateBindingError", () => {
	it("creates error with key and existing binding", () => {
		const error = new DuplicateBindingError("session=test", "lane=abc");

		expect(error.name).toBe("DuplicateBindingError");
		expect(error.message).toContain("Binding conflict");
		expect(error.message).toContain("session=test");
		expect(error.message).toContain("lane=abc");
		expect(error).toBeInstanceOf(Error);
	});

	it("handles lane conflict", () => {
		const error = new DuplicateBindingError("lane=xyz", "session=old-session");

		expect(error.message).toContain("lane=xyz");
		expect(error.message).toContain("old-session");
	});
});
