/**
 * Shared test scaffolding for runtime coverage suites.
 *
 * Several unit tests added in the coverage-raising commits (470a26b8 and
 * follow-ups) repeated the same boilerplate:
 *
 *   - a deterministic temp directory under `os.tmpdir()` that is created in
 *     `beforeEach` and recursively removed in `afterEach`
 *   - a `RecordingBus` that captures every envelope published through the
 *     local bus, so test code can assert on observed side effects
 *   - a `CheckpointSession` factory for the recovery-slice tests
 *
 * Centralising them here keeps the per-test setup terse and removes the
 * "duplicated lines" SonarCloud complaint that motivated the move. The
 * helpers are intentionally small, dependency-light, and side-effect free
 * outside of the lifecycle hooks they expose.
 */

import type { afterEach, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryLocalBus } from "../../src/protocol/bus.js";
import type { LocalBusEnvelope } from "../../src/protocol/types.js";
import type { CheckpointSession } from "../../src/recovery/checkpoint.js";

/**
 * Build a fresh, empty temp directory under `os.tmpdir()`. The name is
 * timestamped and randomly suffixed so parallel test workers do not collide
 * and stale runs from earlier sessions do not bleed in.
 */
export async function emptyDir(prefix: string): Promise<string> {
	const dir = path.join(
		os.tmpdir(),
		`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}

/**
 * Mutable container so callers can keep using `tempDir.dir` inside `it(...)`
 * bodies without converting every reference to a function call. The helper
 * writes the freshly created path into `ref.value` during `beforeEach` and
 * clears it after the test is torn down.
 */
export interface TempDirRef {
	dir: string;
}

/** Bundles the lifecycle hooks the test runner imports from `bun:test`. */
export interface TempDirHooks {
	beforeEach: typeof beforeEach;
	afterEach: typeof afterEach;
}

/**
 * Wire `beforeEach` and `afterEach` to populate `ref.dir` with a freshly
 * created temp directory and recursively remove it after every test.
 *
 * Usage:
 *
 *   const temp: TempDirRef = { dir: "" };
 *   useTempDir("prefix", { beforeEach, afterEach }, temp);
 *   it("...", () => {
 *     // temp.dir is now populated.
 *   });
 */
export function useTempDir(
	prefix: string,
	hooks: TempDirHooks,
	ref: TempDirRef,
): void {
	hooks.beforeEach(async () => {
		ref.dir = await emptyDir(prefix);
	});
	hooks.afterEach(async () => {
		await fs.rm(ref.dir, { recursive: true, force: true }).catch(() => {});
		ref.dir = "";
	});
}

/**
 * `InMemoryLocalBus` subclass that records every published envelope.
 *
 * Mirrors the inline `published` field that the unit tests hand-rolled so
 * assertions like `bus.published.find(...)` keep working unchanged. The
 * parent publish is still awaited so subscribers on the real bus observe
 * the same envelopes the recorder captures.
 */
export class RecordingBus extends InMemoryLocalBus {
	published: LocalBusEnvelope[] = [];

	override async publish(envelope: LocalBusEnvelope): Promise<void> {
		this.published.push(envelope);
		await super.publish(envelope);
	}
}

/**
 * Convenience factory for the minimal `CheckpointSession` shape used by the
 * durability and scheduler coverage tests. `index` controls every id-like
 * field so two sessions never collide and a failure message can name the
 * exact session the test created.
 */
export function makeCheckpointSession(
	index: number,
	workingDirectory = "/tmp",
): CheckpointSession {
	return {
		sessionId: `sess-${index}`,
		terminalId: `term-${index}`,
		laneId: `lane-${index}`,
		workingDirectory,
		environmentVariables: {},
		scrollbackSnapshot: `output-${index}`,
		zelijjSessionName: `zellij-${index}`,
		shellCommand: "bash",
	};
}
