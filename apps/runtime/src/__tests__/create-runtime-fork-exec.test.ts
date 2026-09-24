import { afterEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * F6 — true fork/exec cross-process restart coverage.
 *
 * The sibling test `create-runtime-durability.test.ts` proves the
 * checkpoint survives a "restart" by building two `createRuntime()`
 * lifetimes in one process. That shares the V8 isolate, the module
 * registry, and every cached import, so it cannot catch bugs that only
 * appear when the OS reaps the process and hands a cold process the same
 * dataDir.
 *
 * This file closes that gap. Each lifetime is a separate `bun` process
 * launched with `Bun.spawnSync`, and the first one is terminated via
 * `process.exit()` without `runtime.close()` so nothing gets a chance to
 * flush state or clean up after itself.
 */

const HELPER = path.join(import.meta.dir, "helpers", "fork-exec-helper.ts");

const tempDirs: string[] = [];

async function makeTempDataDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "helios-fork-exec-"));
	tempDirs.push(dir);
	return dir;
}

interface HelperResult {
	mode: string;
	ok: boolean;
	pid: number;
	error?: string;
	[key: string]: unknown;
}

function runHelper(...args: string[]): {
	result: HelperResult;
	exitCode: number;
	stderr: string;
} {
	const proc = Bun.spawnSync(["bun", HELPER, ...args], {
		cwd: path.join(import.meta.dir, "..", "..", ".."),
		env: { ...process.env, NO_COLOR: "1" },
	});

	const stdout = proc.stdout.toString();
	const stderr = proc.stderr.toString();
	const exitCode = proc.exitCode ?? -1;

	// The helper prints exactly one JSON object on stdout. Take the last
	// non-empty line so unrelated runtime logging cannot corrupt parsing.
	const jsonLine = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("{"))
		.pop();

	if (!jsonLine) {
		throw new Error(
			`helper produced no JSON result\nexit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
		);
	}

	return {
		result: JSON.parse(jsonLine) as HelperResult,
		exitCode,
		stderr,
	};
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

describe("cross-process durability restart (F6)", () => {
	it("recovers a checkpoint written by a separate, ungracefully-exited process", async () => {
		const dataDir = await makeTempDataDir();
		const sessionId = "session-fork-exec";

		// First lifetime: its own OS process. Exits without close().
		const seed = runHelper("seed", dataDir, sessionId);
		expect(seed.exitCode).toBe(0);
		expect(seed.result.ok).toBe(true);
		expect(seed.result.error).toBeUndefined();

		// The on-disk artifact must exist and be readable from THIS
		// process, independent of the writer's memory.
		const checkpointPath = path.join(dataDir, "recovery", "checkpoint.json");
		const raw = await fs.readFile(checkpointPath, "utf-8");
		const persisted = JSON.parse(raw) as {
			sessions: Array<{ sessionId: string }>;
			version: number;
		};
		expect(persisted.sessions.map((s) => s.sessionId)).toContain(sessionId);

		// The ungraceful exit left a stale temp file, exactly as a real
		// crash would. This is the debris the next process must tolerate.
		const stalePath = `${checkpointPath}.tmp`;
		expect(await Bun.file(stalePath).exists()).toBe(true);

		// Second lifetime: another separate OS process, cold start.
		const recover = runHelper("recover", dataDir, sessionId);
		expect(recover.exitCode).toBe(0);
		expect(recover.result.ok).toBe(true);
		expect(recover.result.error).toBeUndefined();

		// The three processes must be genuinely distinct. If the helper
		// ever regressed to running in-process this assertion is what
		// catches it, since a shared pid would mean no fork happened.
		expect(recover.result.pid).not.toBe(seed.result.pid);
		expect(recover.result.pid).not.toBe(process.pid);
		expect(seed.result.pid).not.toBe(process.pid);

		// The cold process saw the first process's session.
		expect(recover.result.restoredSessionIds).toContain(sessionId);

		// And it could write a fresh checkpoint on top, which means
		// stale-temp cleanup ran in a real second process.
		expect(recover.result.wroteFreshCheckpoint).toBe(true);
		expect(recover.result.staleTempCleaned).toBe(true);
		expect(await Bun.file(stalePath).exists()).toBe(false);
	}, 60_000);

	it("falls back to the on-disk backup when the primary checkpoint is corrupt", async () => {
		const dataDir = await makeTempDataDir();
		const sessionId = "session-backup-fallback";

		// Two seed lifetimes: the first creates checkpoint.json, the second
		// renames it to checkpoint.json.backup before writing a new primary.
		// That is the only way a backup exists, because the reader falls
		// back to it.
		const first = runHelper("seed", dataDir, sessionId);
		expect(first.exitCode).toBe(0);
		expect(first.result.ok).toBe(true);

		const second = runHelper("seed", dataDir, sessionId);
		expect(second.exitCode).toBe(0);
		expect(second.result.ok).toBe(true);

		const backupPath = path.join(dataDir, "recovery", "checkpoint.json.backup");
		expect(await Bun.file(backupPath).exists()).toBe(true);

		// Third lifetime: a cold process whose primary file is torn.
		const corrupt = runHelper("recover-corrupt", dataDir, sessionId);
		expect(corrupt.exitCode).toBe(0);
		expect(corrupt.result.ok).toBe(true);
		expect(corrupt.result.error).toBeUndefined();

		// It must have gotten the session back despite the corrupt primary.
		expect(corrupt.result.restoredSessionIds).toContain(sessionId);
		expect(corrupt.result.recoveredViaBackup).toBe(true);
		expect(corrupt.result.primaryRejected).toBe(true);

		// And it is yet another distinct process.
		expect(corrupt.result.pid).not.toBe(first.result.pid);
		expect(corrupt.result.pid).not.toBe(second.result.pid);
		expect(corrupt.result.pid).not.toBe(process.pid);
	}, 60_000);

	it("surfaces a helper failure as a non-zero exit with a JSON error", async () => {
		const dataDir = await makeTempDataDir();

		// No seed ran, so a recover attempt must fail cleanly rather than
		// crash the suite. This pins the helper's error contract: the
		// parent test relies on always getting parseable JSON.
		const recover = runHelper("recover", dataDir, "session-never-seeded");
		expect(recover.exitCode).toBe(1);
		expect(recover.result.ok).toBe(false);
		expect(typeof recover.result.error).toBe("string");
		expect(recover.result.error as string).toContain("session-never-seeded");
	}, 60_000);

	it("rejects an unknown mode with exit code 2", async () => {
		const dataDir = await makeTempDataDir();
		const bad = runHelper("not-a-mode", dataDir, "session-x");
		expect(bad.exitCode).toBe(2);
		expect(bad.result.ok).toBe(false);
	}, 60_000);
});
