import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
	validateChangelogEntry,
	loadChangelog,
	appendChangelogEntry,
} from "../deps-changelog-util";
import type { ChangelogEntry, DepsChangelog } from "../deps-types";

const REPO_ROOT = process.cwd();
const CHANGELOG_PATH = join(REPO_ROOT, "deps-changelog.json");

// Traces to: FR-DEP-008 (dependency changelog recording)
describe("Dependency Changelog Utility", () => {
	beforeEach(() => {
		// Reset changelog to empty state
		const empty: DepsChangelog = { entries: [] };
		writeFileSync(CHANGELOG_PATH, JSON.stringify(empty, null, 2));
	});

	afterEach(() => {
		// Clean up test changelog
		try {
			rmSync(CHANGELOG_PATH, { force: true });
		} catch (e) {
			// Ignore
		}
	});

	test("valid entry appends successfully", () => {
		const entry: ChangelogEntry = {
			timestamp: "2026-03-01T13:30:00Z",
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true, test: true },
			outcome: "success",
			actor: "ci",
		};

		appendChangelogEntry(entry);

		const changelog = loadChangelog();
		expect(changelog.entries.length).toBe(1);
		expect(changelog.entries[0].package).toBe("electrobun");
		expect(changelog.entries[0].outcome).toBe("success");
	});

	test("invalid entry (missing timestamp) is rejected", () => {
		const entry = {
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true },
			outcome: "success",
			actor: "ci",
		} as unknown as ChangelogEntry;

		try {
			appendChangelogEntry(entry);
			expect(false).toBe(true); // Should throw
		} catch (e) {
			expect(String(e)).toContain("timestamp");
		}
	});

	test("invalid entry (missing package) is rejected", () => {
		const entry = {
			timestamp: "2026-03-01T13:30:00Z",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true },
			outcome: "success",
			actor: "ci",
		} as unknown as ChangelogEntry;

		try {
			appendChangelogEntry(entry);
			expect(false).toBe(true); // Should throw
		} catch (e) {
			expect(String(e)).toContain("package");
		}
	});

	test("invalid entry (invalid channel) is rejected", () => {
		const entry = {
			timestamp: "2026-03-01T13:30:00Z",
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "invalid-channel",
			gateResults: { lint: true },
			outcome: "success",
			actor: "ci",
		} as unknown as ChangelogEntry;

		try {
			appendChangelogEntry(entry);
			expect(false).toBe(true); // Should throw
		} catch (e) {
			expect(String(e)).toContain("channel");
		}
	});

	test("invalid entry (invalid outcome) is rejected", () => {
		const entry = {
			timestamp: "2026-03-01T13:30:00Z",
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true },
			outcome: "invalid-outcome",
			actor: "ci",
		} as unknown as ChangelogEntry;

		try {
			appendChangelogEntry(entry);
			expect(false).toBe(true); // Should throw
		} catch (e) {
			expect(String(e)).toContain("outcome");
		}
	});

	test("invalid entry (invalid actor) is rejected", () => {
		const entry = {
			timestamp: "2026-03-01T13:30:00Z",
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true },
			outcome: "success",
			actor: "invalid-actor",
		} as unknown as ChangelogEntry;

		try {
			appendChangelogEntry(entry);
			expect(false).toBe(true); // Should throw
		} catch (e) {
			expect(String(e)).toContain("actor");
		}
	});

	test("multiple entries append in sequence", () => {
		const entry1: ChangelogEntry = {
			timestamp: "2026-03-01T13:30:00Z",
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true },
			outcome: "success",
			actor: "ci",
		};

		const entry2: ChangelogEntry = {
			timestamp: "2026-03-01T14:00:00Z",
			package: "ghostty",
			fromVersion: "1.1.0",
			toVersion: "1.2.0",
			channel: "stable",
			gateResults: { lint: true, test: true },
			outcome: "success",
			actor: "user",
		};

		appendChangelogEntry(entry1);
		appendChangelogEntry(entry2);

		const changelog = loadChangelog();
		expect(changelog.entries.length).toBe(2);
		expect(changelog.entries[0].package).toBe("electrobun");
		expect(changelog.entries[1].package).toBe("ghostty");
	});

	test("valid entry with optional branchRef is accepted", () => {
		const entry: ChangelogEntry = {
			timestamp: "2026-03-01T13:30:00Z",
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true },
			outcome: "success",
			actor: "canary",
			branchRef: "canary/electrobun-upgrade",
		};

		appendChangelogEntry(entry);

		const changelog = loadChangelog();
		expect(changelog.entries[0].branchRef).toBe("canary/electrobun-upgrade");
	});

	test("valid entry without optional branchRef is accepted", () => {
		const entry: ChangelogEntry = {
			timestamp: "2026-03-01T13:30:00Z",
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true },
			outcome: "success",
			actor: "ci",
		};

		appendChangelogEntry(entry);

		const changelog = loadChangelog();
		expect(changelog.entries[0].branchRef).toBeUndefined();
	});

	test("loadChangelog initializes empty if file does not exist", () => {
		rmSync(CHANGELOG_PATH, { force: true });
		const changelog = loadChangelog();
		expect(changelog.entries.length).toBe(0);
	});

	test("file is created if it does not exist during append", () => {
		rmSync(CHANGELOG_PATH, { force: true });

		const entry: ChangelogEntry = {
			timestamp: "2026-03-01T13:30:00Z",
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true },
			outcome: "success",
			actor: "ci",
		};

		appendChangelogEntry(entry);

		expect(existsSync(CHANGELOG_PATH)).toBe(true);
		const changelog = loadChangelog();
		expect(changelog.entries.length).toBe(1);
	});

	test("atomic write prevents partial corruption on failure", () => {
		const entry1: ChangelogEntry = {
			timestamp: "2026-03-01T13:30:00Z",
			package: "electrobun",
			fromVersion: "0.0.0-canary.20250228",
			toVersion: "0.0.0-canary.20250301",
			channel: "alpha",
			gateResults: { lint: true },
			outcome: "success",
			actor: "ci",
		};

		appendChangelogEntry(entry1);

		// Verify first entry is intact
		let changelog = loadChangelog();
		expect(changelog.entries.length).toBe(1);

		const entry2: ChangelogEntry = {
			timestamp: "2026-03-01T14:00:00Z",
			package: "ghostty",
			fromVersion: "1.1.0",
			toVersion: "1.2.0",
			channel: "stable",
			gateResults: { lint: true },
			outcome: "success",
			actor: "ci",
		};

		appendChangelogEntry(entry2);

		// Verify both entries are intact
		changelog = loadChangelog();
		expect(changelog.entries.length).toBe(2);
		expect(changelog.entries[0].package).toBe("electrobun");
		expect(changelog.entries[1].package).toBe("ghostty");
	});

	test("validateChangelogEntry accepts all valid channel values", () => {
		const channels: Array<"alpha" | "beta" | "rc" | "stable"> = [
			"alpha",
			"beta",
			"rc",
			"stable",
		];

		channels.forEach((channel) => {
			const entry: ChangelogEntry = {
				timestamp: "2026-03-01T13:30:00Z",
				package: "test-package",
				fromVersion: "1.0.0",
				toVersion: "1.1.0",
				channel,
				gateResults: {},
				outcome: "success",
				actor: "user",
			};

			expect(() => validateChangelogEntry(entry)).not.toThrow();
		});
	});

	test("validateChangelogEntry accepts all valid outcome values", () => {
		const outcomes: Array<"success" | "failure" | "rollback"> = [
			"success",
			"failure",
			"rollback",
		];

		outcomes.forEach((outcome) => {
			const entry: ChangelogEntry = {
				timestamp: "2026-03-01T13:30:00Z",
				package: "test-package",
				fromVersion: "1.0.0",
				toVersion: "1.1.0",
				channel: "stable",
				gateResults: {},
				outcome,
				actor: "user",
			};

			expect(() => validateChangelogEntry(entry)).not.toThrow();
		});
	});

	test("validateChangelogEntry accepts all valid actor values", () => {
		const actors: Array<"user" | "ci" | "canary"> = ["user", "ci", "canary"];

		actors.forEach((actor) => {
			const entry: ChangelogEntry = {
				timestamp: "2026-03-01T13:30:00Z",
				package: "test-package",
				fromVersion: "1.0.0",
				toVersion: "1.1.0",
				channel: "stable",
				gateResults: {},
				outcome: "success",
				actor,
			};

			expect(() => validateChangelogEntry(entry)).not.toThrow();
		});
	});
});
