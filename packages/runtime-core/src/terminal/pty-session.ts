/**
 * Terminal sessions backed by the native PTY pool.
 *
 * This is the seam the renderer's terminal store was leaving open: its
 * `writeToTerminal` was a stub that only logged, with a TODO to wire up a
 * backend. A session here owns one native PTY handle and pumps it.
 *
 * Polling rather than event-driven: the pool exposes a non-blocking read and a
 * pump that drains the fd into a ring buffer, so a short interval keeps latency
 * acceptable without needing kqueue or epoll plumbed through the ABI. The
 * interval is deliberately small; terminal echo feels broken above roughly 16ms.
 *
 * Nothing here imports the store, so the store can depend on this without a
 * cycle, and the module stays testable on its own.
 */
import { PtyPool, type PtySpawnOptions } from "../ffi/index.ts";

/** How often a session drains its PTY. */
export const DEFAULT_POLL_MS = 8;

export interface PtySessionHandlers {
  /** Output from the child, for xterm.js to consume. */
  onData?: (chunk: Uint8Array) => void;
  /** The child exited; the session is no longer usable. */
  onExit?: (exitCode: number) => void;
}

interface Session {
  handle: number;
  timer: ReturnType<typeof setInterval>;
  handlers: PtySessionHandlers;
}

export class PtySessionManager {
  #pool: PtyPool | null = null;
  #sessions = new Map<string, Session>();
  #pollMs: number;
  #maxPty: number;

  constructor(options: { pollMs?: number; maxPty?: number } = {}) {
    this.#pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.#maxPty = options.maxPty ?? 64;
  }

  /** Load the native library on first use, not at import time. */
  #ensurePool(): PtyPool {
    if (this.#pool === null) this.#pool = new PtyPool(this.#maxPty);
    return this.#pool;
  }

  get isLoaded(): boolean {
    return this.#pool !== null;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  has(id: string): boolean {
    return this.#sessions.has(id);
  }

  /**
   * Start a shell in a new PTY under `id`.
   *
   * Throws if `id` is already open, which is almost always a bug in the caller
   * rather than something to paper over: two sessions sharing an id would mean
   * one handle leaks and its output is delivered to the wrong terminal.
   */
  open(id: string, options: PtySpawnOptions = {}, handlers: PtySessionHandlers = {}): number {
    if (this.#sessions.has(id)) {
      throw new Error(`pty session "${id}" is already open`);
    }

    const pool = this.#ensurePool();
    const handle = pool.spawn(options);

    const session: Session = {
      handle,
      handlers,
      timer: setInterval(() => this.#drain(id), this.#pollMs),
    };
    this.#sessions.set(id, session);

    return handle;
  }

  /** Pull available output and hand it to the session's handler. */
  #drain(id: string): void {
    const session = this.#sessions.get(id);
    if (session === undefined) return;

    const pool = this.#pool;
    if (pool === null) return;

    try {
      pool.pump(session.handle);
      const chunk = pool.read(session.handle);
      if (chunk.length > 0) session.handlers.onData?.(chunk);
    } catch (cause) {
      // A read against a closed handle throws. Treat it as the session ending
      // rather than letting an interval callback take down the process, and
      // report why so a real fault is not silently swallowed.
      this.#finish(id, -1, cause);
      return;
    }

    if (pool.reap(session.handle) || pool.exitCode(session.handle) !== -2) {
      this.#finish(id, pool.exitCode(session.handle));
    }
  }

  #finish(id: string, exitCode: number, cause?: unknown): void {
    const session = this.#sessions.get(id);
    if (session === undefined) return;

    clearInterval(session.timer);
    this.#sessions.delete(id);

    // Destroy the handle so the slot returns to the pool. Done defensively: a
    // session that has already exited may have had its handle reclaimed.
    try {
      this.#pool?.destroy(session.handle);
    } catch {
      /* already gone */
    }

    if (cause !== undefined) {
      session.handlers.onExit?.(-1);
      return;
    }
    session.handlers.onExit?.(exitCode);
  }

  /** Send input to the child. Returns bytes accepted, or 0 if unknown. */
  write(id: string, data: string | Uint8Array): number {
    const session = this.#sessions.get(id);
    if (session === undefined || this.#pool === null) return 0;
    return this.#pool.write(session.handle, data);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.#sessions.get(id);
    if (session === undefined || this.#pool === null) return;
    this.#pool.resize(session.handle, cols, rows);
  }

  close(id: string): void {
    if (this.#sessions.has(id)) this.#finish(id, -1);
  }

  closeAll(): void {
    for (const id of [...this.#sessions.keys()]) this.close(id);
  }
}
