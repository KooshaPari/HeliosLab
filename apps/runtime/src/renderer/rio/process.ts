/**
 * Rio process lifecycle management.
 *
 * Manages the rio process from spawn to termination, including crash
 * detection and SIGTERM -> SIGKILL escalation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RioOptions {
	gpuAcceleration: boolean;
}

type ExitHandler = (code: number) => void;

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

const SIGKILL_TIMEOUT_MS = 3000;

export class RioProcess {
	private _proc: ReturnType<typeof Bun.spawn> | undefined;
	private _pid: number | undefined;
	private _running = false;
	private _startedAt: number | undefined;
	private _exitHandlers: ExitHandler[] = [];
	private _startLock = false;

	/**
	 * Spawn the rio process.
	 *
	 * @returns Object with the spawned PID.
	 * @throws If the rio binary is not found or spawn fails.
	 */
	async start(options: RioOptions): Promise<{ pid: number }> {
		if (this._startLock) {
			throw new Error("Rio process start already in progress (serialized)");
		}
		this._startLock = true;

		try {
			const args = ["rio"];
			if (!options.gpuAcceleration) {
				args.push("--no-gpu");
			}

			this._proc = Bun.spawn(args, {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});

			this._pid = this._proc.pid;
			this._running = true;
			this._startedAt = Date.now();

			// Monitor for unexpected exit.
			this._proc.exited.then((code) => {
				this._running = false;
				for (const handler of this._exitHandlers) {
					try {
						handler(code);
					} catch {
						// handlers must not throw
					}
				}
			});

			return { pid: this._pid };
		} catch (err) {
			this._running = false;
			this._startLock = false;
			throw new Error(
				`Failed to start rio process: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			this._startLock = false;
		}
	}

	/**
	 * Stop the rio process with SIGTERM -> SIGKILL escalation.
	 */
	async stop(): Promise<void> {
		if (!this._proc || !this._running) {
			return;
		}

		// Send SIGTERM first.
		this._proc.kill("SIGTERM");

		// Wait up to SIGKILL_TIMEOUT_MS, then escalate.
		const exitPromise = this._proc.exited;
		const timeout = new Promise<"timeout">((resolve) =>
			setTimeout(() => resolve("timeout"), SIGKILL_TIMEOUT_MS),
		);

		const result = await Promise.race([exitPromise, timeout]);
		if (result === "timeout") {
			this._proc.kill("SIGKILL");
			await this._proc.exited;
		}

		this._running = false;
		this._proc = undefined;
	}

	isRunning(): boolean {
		return this._running;
	}

	getPid(): number | undefined {
		return this._pid;
	}

	getUptime(): number | undefined {
		if (this._startedAt === undefined) return undefined;
		return Date.now() - this._startedAt;
	}

	/**
	 * Register a handler called when the process exits.
	 */
	onExit(handler: ExitHandler): void {
		this._exitHandlers.push(handler);
	}

	/**
	 * Write data to the rio process stdin.
	 */
	writeToStdin(data: Uint8Array): void {
		if (!this._proc || !this._running) return;
		try {
			const stdin = this._proc.stdin;
			if (stdin && typeof stdin === "object" && "write" in stdin) {
				(stdin as { write(data: Uint8Array): number }).write(data);
			}
		} catch {
			// Process may have died between the check and the write.
		}
	}
}
