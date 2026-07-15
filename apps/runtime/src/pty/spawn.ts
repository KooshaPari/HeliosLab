/**
 * PTY spawn — creates functional PTY processes via Bun.spawn
 * and registers them in the process registry.
 *
 * @module
 */

import { PtyLifecycle } from "./state_machine.js";
import type { PtyRecord, PtyDimensions } from "./registry.js";
import { PtyRegistry } from "./registry.js";

/** Options for spawning a new PTY. */
export interface SpawnOptions {
  /** Path to the shell binary (default: /bin/bash). */
  shell?: string | undefined;
  /** Working directory for the spawned shell. */
  cwd?: string | undefined;
  /** Environment variables for the spawned shell. */
  env?: Record<string, string> | undefined;
  /** Number of columns (default: 80). */
  cols?: number | undefined;
  /** Number of rows (default: 24). */
  rows?: number | undefined;
  /** Lane ID that owns this PTY. */
  laneId: string;
  /** Session ID that owns this PTY. */
  sessionId: string;
  /** Terminal ID that owns this PTY. */
  terminalId: string;
}

/** Result of a spawn operation, including timing data. */
export interface SpawnResult {
  readonly record: PtyRecord;
  readonly spawnLatencyMs: number;
}

/**
 * Generate a PTY ID (UUID v4).
 */
function generatePtyId(): string {
  return crypto.randomUUID();
}

/**
 * Spawn a new PTY process, register it, and return the record.
 *
 * The function transitions the PTY through idle -> spawning -> active.
 * On failure it transitions to errored and does NOT register a record.
 *
 * @param options - Spawn configuration.
 * @param registry - The PTY registry to register the new process in.
 * @returns The spawn result including the PTY record and latency.
 * @throws If the shell binary is not found or spawn fails.
 */
export async function spawnPty(options: SpawnOptions, registry: PtyRegistry): Promise<SpawnResult> {
  const startTime = performance.now();
  const ptyId = generatePtyId();
  const lifecycle = new PtyLifecycle(ptyId);

  const shell = options.shell ?? "/bin/bash";
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? {};
  const cols = options.cols ?? 80;
  const rows = options.rows ?? 24;

  // idle -> spawning
  lifecycle.apply("spawn_requested");

  try {
    const proc = Bun.spawn([shell], {
      cwd,
      env: {
        ...env,
        TERM: env["TERM"] ?? "xterm-256color",
        COLUMNS: String(cols),
        LINES: String(rows),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const pid = proc.pid;

    if (pid <= 0) {
      lifecycle.apply("spawn_failed");
      throw new Error(`Spawn returned invalid PID: ${pid}`);
    }

    // spawning -> active
    lifecycle.apply("spawn_succeeded");

    const dimensions: PtyDimensions = { cols, rows };
    const now = Date.now();

    const record: PtyRecord = {
      ptyId,
      laneId: options.laneId,
      sessionId: options.sessionId,
      terminalId: options.terminalId,
      pid,
      state: lifecycle.state,
      dimensions,
      createdAt: now,
      updatedAt: now,
      env: Object.freeze({ ...env }),
    };

    registry.register(record);

    const spawnLatencyMs = performance.now() - startTime;
    return { record, spawnLatencyMs };
  } catch (error) {
    // If still in spawning state, transition to errored
    if (lifecycle.state === "spawning") {
      lifecycle.apply("spawn_failed");
    }
    throw error;
  }
}
