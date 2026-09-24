/**
 * F6 — cross-process durability helper.
 *
 * Spawned as a real OS process by
 * `apps/runtime/src/__tests__/create-runtime-fork-exec.test.ts`
 * so the "second lifetime" of the restart test does not share a V8
 * isolate, module registry, or in-memory state with the first.
 *
 * Two modes:
 *   - `seed`   : create a runtime, register a lane + session, force a
 *                checkpoint, print the observed session ids, then
 *                `process.exit(0)` WITHOUT calling `runtime.close()`.
 *                This is the "host process was killed" path: no graceful
 *                shutdown, no final checkpoint, no cleanup.
 *   - `recover` : open a fresh runtime on the same dataDir, read the
 *                checkpoint, and prove the first process's session is
 *                visible from a genuinely cold process.
 *
 * Contract: every result is a single JSON object on stdout, so the
 * parent never has to parse logs.
 */
import { createRuntime } from "../../index.js";

interface SeedResult {
	mode: "seed";
	ok: boolean;
	workspaceId: string;
	sessionId: string;
	pid: number;
	checkpointPath: string;
	staleTempLeftBehind: boolean;
	error?: string;
}

interface RecoverResult {
	mode: "recover";
	ok: boolean;
	pid: number;
	restoredSessionIds: string[];
	restoredVersion: number | null;
	staleTempCleaned: boolean;
	wroteFreshCheckpoint: boolean;
	freshSessionIds: string[];
	error?: string;
}

interface CorruptRecoverResult {
	mode: "recover-corrupt";
	ok: boolean;
	pid: number;
	restoredSessionIds: string[];
	recoveredViaBackup: boolean;
	primaryRejected: boolean;
	error?: string;
}

type Result = SeedResult | RecoverResult | CorruptRecoverResult;

function emit(result: Result): void {
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function seed(
	dataDir: string,
	workspaceId: string,
	sessionId: string,
): Promise<void> {
	let result: SeedResult = {
		mode: "seed",
		ok: false,
		workspaceId,
		sessionId,
		pid: process.pid,
		checkpointPath: "",
		staleTempLeftBehind: false,
	};

	try {
		const runtime = createRuntime({ dataDir });

		await runtime.bus.request({
			id: `cmd-lane-create-${sessionId}`,
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: workspaceId,
			correlation_id: `corr-${sessionId}-lane`,
			method: "lane.create",
			payload: { id: `lane-${sessionId}` },
		});

		await runtime.bus.request({
			id: `cmd-session-attach-${sessionId}`,
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: workspaceId,
			lane_id: `lane-${sessionId}`,
			session_id: sessionId,
			correlation_id: `corr-${sessionId}-session`,
			method: "session.attach",
			payload: {
				id: sessionId,
				lane_id: `lane-${sessionId}`,
				codex_session_id: `codex-${sessionId}`,
			},
		});

		const durability = await runtime.getDurability();
		await durability.checkpointNow();

		const checkpoint = await durability.readCheckpoint();
		const sessionIds = (checkpoint?.sessions ?? []).map((s) => s.sessionId);
		if (!sessionIds.includes(sessionId)) {
			throw new Error(
				`seed checkpoint missing ${sessionId}, got ${JSON.stringify(sessionIds)}`,
			);
		}

		const checkpointPath = durability.getReader().getCheckpointPath();
		result = {
			...result,
			ok: true,
			checkpointPath,
		};

		// Leave a stale temp file behind so the recovering process has to
		// deal with exactly the debris an ungraceful death leaves on disk.
		// `CheckpointWriter.cleanStaleTempFiles()` unlinks it on next write.
		await Bun.write(`${checkpointPath}.tmp`, '{"partial":true}');

		emit(result);

		// Hard exit: skip `runtime.close()` so no final checkpoint and no
		// cleanup runs. This is the whole point of the fork/exec test.
		process.exit(0);
	} catch (err) {
		emit({
			...result,
			error: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}
}

async function recover(dataDir: string, sessionId: string): Promise<void> {
	let result: RecoverResult = {
		mode: "recover",
		ok: false,
		pid: process.pid,
		restoredSessionIds: [],
		restoredVersion: null,
		staleTempCleaned: false,
		wroteFreshCheckpoint: false,
		freshSessionIds: [],
	};

	try {
		const runtime = createRuntime({ dataDir });
		const durability = await runtime.getDurability();
		const reader = durability.getReader();
		const checkpointPath = reader.getCheckpointPath();

		// The previous process was killed mid-life, so confirm the debris
		// it left is actually on disk before claiming we cleaned it.
		const stalePath = `${checkpointPath}.tmp`;
		const staleExisted = await Bun.file(stalePath).exists();

		const restored = await durability.readCheckpoint();
		const restoredSessionIds = (restored?.sessions ?? []).map(
			(s) => s.sessionId,
		);

		if (!restoredSessionIds.includes(sessionId)) {
			throw new Error(
				`cold process could not see ${sessionId}, got ${JSON.stringify(restoredSessionIds)}`,
			);
		}

		// Write a fresh checkpoint on top of the recovered state, which is
		// what exercises stale-temp cleanup in a real second process.
		const freshSessionId = `${sessionId}-recovered`;
		await runtime.bus.request({
			id: `cmd-lane-create-${freshSessionId}`,
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: "ws-fork-exec-recover",
			correlation_id: `corr-${freshSessionId}-lane`,
			method: "lane.create",
			payload: { id: `lane-${freshSessionId}` },
		});
		await runtime.bus.request({
			id: `cmd-session-attach-${freshSessionId}`,
			type: "command",
			ts: new Date().toISOString(),
			workspace_id: "ws-fork-exec-recover",
			lane_id: `lane-${freshSessionId}`,
			session_id: freshSessionId,
			correlation_id: `corr-${freshSessionId}-session`,
			method: "session.attach",
			payload: {
				id: freshSessionId,
				lane_id: `lane-${freshSessionId}`,
				codex_session_id: `codex-${freshSessionId}`,
			},
		});

		await durability.checkpointNow();

		const refreshed = await durability.readCheckpoint();
		const freshSessionIds = (refreshed?.sessions ?? []).map((s) => s.sessionId);
		if (!freshSessionIds.includes(freshSessionId)) {
			throw new Error(
				`fresh checkpoint missing ${freshSessionId}, got ${JSON.stringify(freshSessionIds)}`,
			);
		}

		// A clean write leaves no .tmp behind: `write()` renames the temp
		// file away. Note this is true whether or not the stale-temp
		// unlink ran, because `fs.writeFile` truncates the same path and
		// the rename removes it either way. The assertion that the
		// recovery is *correct* is the `restoredSessionIds` check above,
		// not the absence of the temp file.
		const staleAfter = await Bun.file(stalePath).exists();

		result = {
			mode: "recover",
			ok: true,
			pid: process.pid,
			restoredSessionIds,
			restoredVersion: restored?.version ?? null,
			staleTempCleaned: staleExisted && !staleAfter,
			wroteFreshCheckpoint: true,
			freshSessionIds,
		};

		emit(result);
		await runtime.close();
		process.exit(0);
	} catch (err) {
		emit({
			...result,
			error: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}
}

/**
 * Cold-start read of a checkpoint whose primary file has been corrupted
 * after the writing process died. `CheckpointReader.read()` must fall
 * back to the `.backup` file that `backupPreviousCheckpoint()` left
 * behind, and a genuinely separate process must still be able to see the
 * original session through that fallback.
 */
async function recoverFromCorruptPrimary(
	dataDir: string,
	sessionId: string,
): Promise<void> {
	let result: CorruptRecoverResult = {
		mode: "recover-corrupt",
		ok: false,
		pid: process.pid,
		restoredSessionIds: [],
		recoveredViaBackup: false,
		primaryRejected: false,
	};

	try {
		const runtime = createRuntime({ dataDir });
		const durability = await runtime.getDurability();
		const checkpointPath = durability.getReader().getCheckpointPath();

		// Simulate a torn write. The payload stays *valid JSON with the
		// right shape*, but its checksum no longer matches its sessions.
		// This matters: an unparseable file would be rejected by the
		// `catch` in `read()` instead, and would never exercise
		// `verifyChecksum()` at all.
		//
		// The session list is also swapped for a decoy. If the reader ever
		// accepted the tampered primary, it would return the decoy instead
		// of the real session from the backup, so the caller's
		// "restores the real session" assertion fails. That makes the
		// checksum check observable from the outside, rather than relying
		// on the reader happening to reject the file for some other reason.
		const original = await Bun.file(checkpointPath).text();
		const parsed = JSON.parse(original) as Record<string, unknown>;
		const decoySessionId = `${sessionId}-TAMPERED-PRIMARY`;
		const decoy = Array.isArray(parsed.sessions)
			? [
					{
						...(parsed.sessions[0] as Record<string, unknown>),
						sessionId: decoySessionId,
					},
				]
			: [{ sessionId: decoySessionId }];
		await Bun.write(
			checkpointPath,
			JSON.stringify({
				...parsed,
				sessions: decoy,
				checksum: "deadbeef".repeat(8),
			}),
		);

		const restored = await durability.readCheckpoint();
		const restoredSessionIds = (restored?.sessions ?? []).map(
			(s) => s.sessionId,
		);

		if (restored === null) {
			throw new Error("cold process lost the checkpoint entirely");
		}
		if (!restoredSessionIds.includes(sessionId)) {
			throw new Error(
				`backup fallback lost ${sessionId}, got ${JSON.stringify(restoredSessionIds)}`,
			);
		}

		// The decoy never appears in what was restored, even though it is
		// sitting in the primary file on disk. That is the observable proof
		// the primary was rejected on its checksum and the backup was used.
		const restoredIncludesDecoy = restoredSessionIds.includes(decoySessionId);
		const primaryRejected = !restoredIncludesDecoy;

		result = {
			mode: "recover-corrupt",
			ok: true,
			pid: process.pid,
			restoredSessionIds,
			recoveredViaBackup: true,
			primaryRejected,
		};

		emit(result);
		await runtime.close();
		process.exit(0);
	} catch (err) {
		emit({
			...result,
			error: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}
}

const [mode, dataDir, sessionId] = process.argv.slice(2);

if (!mode || !dataDir || !sessionId) {
	emit({
		mode: "unknown",
		ok: false,
		pid: process.pid,
		error: `usage: fork-exec-helper <seed|recover> <dataDir> <sessionId>, got ${process.argv.slice(2).join(" ")}`,
	} as unknown as Result);
	process.exit(2);
}

if (mode === "seed") {
	await seed(dataDir, `ws-${sessionId}`, sessionId);
} else if (mode === "recover") {
	await recover(dataDir, sessionId);
} else if (mode === "recover-corrupt") {
	await recoverFromCorruptPrimary(dataDir, sessionId);
} else {
	emit({
		mode: "unknown",
		ok: false,
		pid: process.pid,
		error: `unknown mode: ${mode}`,
	} as unknown as Result);
	process.exit(2);
}
