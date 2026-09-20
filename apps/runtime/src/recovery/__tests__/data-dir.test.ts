import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	DEFAULT_DATA_SUBDIR,
	DEFAULT_HELIOS_HOME,
	deriveWorkspaceId,
	getHome,
	resetHome,
	resolveDefaultDataDir,
	resolveDefaultDataDirSync,
	setHome,
} from "../data-dir.js";

const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-data-dir-test-"));
	tempDirs.push(dir);
	return dir;
}

async function makeTempCwd(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-data-dir-cwd-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	resetHome();
	for (const dir of tempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

describe("resolveDefaultDataDir", () => {
	it("returns a path under the helios data root", async () => {
		const home = await makeTempHome();
		setHome(home);

		const result = await resolveDefaultDataDir("workspace-alpha");

		expect(result.startsWith(home)).toBe(true);
		expect(result).toContain(
			path.join(DEFAULT_HELIOS_HOME, DEFAULT_DATA_SUBDIR),
		);
		expect(result.endsWith("workspace-alpha")).toBe(true);
	});

	it("creates the target directory recursively", async () => {
		const home = await makeTempHome();
		setHome(home);

		const result = await resolveDefaultDataDir("workspace-creates");

		const stat = await fs.stat(result);
		expect(stat.isDirectory()).toBe(true);
	});

	it("returns the same path for the same workspace id", async () => {
		const home = await makeTempHome();
		setHome(home);

		const first = await resolveDefaultDataDir("workspace-stable");
		const second = await resolveDefaultDataDir("workspace-stable");

		expect(first).toBe(second);
	});

	it("uses getHome() and respects overrides", async () => {
		const home = await makeTempHome();
		setHome(home);

		const derived = resolveDefaultDataDirSync("workspace-from-sync");
		expect(getHome()).toBe(home);
		expect(derived.startsWith(home)).toBe(true);
	});
});

describe("deriveWorkspaceId", () => {
	beforeEach(() => {
		// No HOME override needed; the function only inspects the cwd.
		resetHome();
	});

	it("returns the same id for the same cwd", async () => {
		const cwd = await makeTempCwd();
		const first = await deriveWorkspaceId(cwd);
		const second = await deriveWorkspaceId(cwd);
		expect(first).toBe(second);
		expect(first).toMatch(/^[0-9a-f]{16}$/);
	});

	it("returns different ids for different cwds", async () => {
		const cwdA = await makeTempCwd();
		const cwdB = await makeTempCwd();
		const idA = await deriveWorkspaceId(cwdA);
		const idB = await deriveWorkspaceId(cwdB);
		expect(idA).not.toBe(idB);
	});

	it("incorporates package.json content when present", async () => {
		const cwd = await makeTempCwd();
		await fs.writeFile(
			path.join(cwd, "package.json"),
			JSON.stringify({ name: "alpha" }),
		);
		const other = await makeTempCwd();
		await fs.writeFile(
			path.join(other, "package.json"),
			JSON.stringify({ name: "beta" }),
		);

		const idAlpha = await deriveWorkspaceId(cwd);
		const idBeta = await deriveWorkspaceId(other);
		expect(idAlpha).not.toBe(idBeta);
	});
});
