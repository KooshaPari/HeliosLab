import { createSignal } from "solid-js";
import { PtySessionManager } from "../../../../packages/runtime-core/src/terminal/pty-session.ts";

export type TerminalInfo = {
	id: string;
	name: string;
};

const [terminals, setTerminals] = createSignal<TerminalInfo[]>([]);
const [activeTerminalId, setActiveTerminalId] = createSignal<string | null>(
	null,
);

let nextId = 1;

/**
 * One native PTY per terminal.
 *
 * Created lazily, and only on first use, so importing this store in an
 * environment without the native library costs nothing. If construction fails
 * the store still works as a tab list and `ptyUnavailableReason` says why, which
 * keeps the renderer usable on Windows where a Mach-O or ELF library cannot
 * load. Silently swallowing the failure would make a missing build look like a
 * terminal that simply produces no output.
 */
let manager: PtySessionManager | null = null;
let unavailableReason: string | null = null;

/** Data subscribers, one per panel that has mounted a terminal. */
const subscribers = new Map<string, Set<(chunk: Uint8Array) => void>>();

function getManager(): PtySessionManager | null {
	if (manager !== null) return manager;
	if (unavailableReason !== null) return null;

	try {
		manager = new PtySessionManager({ pollMs: 8, maxPty: 64 });
		return manager;
	} catch (cause) {
		unavailableReason = cause instanceof Error ? cause.message : String(cause);
		return null;
	}
}

/** Why the native PTY layer is unavailable, or null if it loaded. */
export function ptyUnavailableReason(): string | null {
	getManager();
	return unavailableReason;
}

function publish(terminalId: string, chunk: Uint8Array): void {
	const listeners = subscribers.get(terminalId);
	if (listeners === undefined) return;
	for (const listener of listeners) listener(chunk);
}

/**
 * Subscribe a panel to a terminal's output. Returns an unsubscribe function.
 *
 * The panel owns the xterm instance, so it pulls output rather than the store
 * pushing into a DOM node it does not own.
 */
export function subscribeToTerminal(
	terminalId: string,
	listener: (chunk: Uint8Array) => void,
): () => void {
	let listeners = subscribers.get(terminalId);
	if (listeners === undefined) {
		listeners = new Set();
		subscribers.set(terminalId, listeners);
	}
	listeners.add(listener);

	return () => {
		const current = subscribers.get(terminalId);
		if (current === undefined) return;
		current.delete(listener);
		if (current.size === 0) subscribers.delete(terminalId);
	};
}

export function createTerminal(): string {
	const id = `term-${nextId++}`;
	const name = `Terminal ${nextId - 1}`;

	setTerminals((prev: TerminalInfo[]) => [...prev, { id, name }]);
	setActiveTerminalId(id);

	const active = getManager();
	if (active !== null) {
		try {
			active.open(id, { shell: "/bin/zsh", cwd: undefined }, {
				onData: (chunk) => publish(id, chunk),
				onExit: () => {
					// The child is gone. Leave the tab in place so its final
					// output stays readable, but stop claiming it is live.
					publish(id, new TextEncoder().encode("\r\n[process exited]\r\n"));
				},
			});
		} catch (cause) {
			// Opening can fail for reasons that are not a missing library, such
			// as exhausting the pool. Record it rather than leaving the user
			// with a tab that silently does nothing.
			unavailableReason = cause instanceof Error ? cause.message : String(cause);
		}
	}

	return id;
}

export function closeTerminal(id: string): void {
	manager?.close(id);
	subscribers.delete(id);

	setTerminals((prev: TerminalInfo[]) => prev.filter((t) => t.id !== id));
	const remaining = terminals();
	if (activeTerminalId() === id) {
		setActiveTerminalId(
			remaining.length > 0 ? remaining[remaining.length - 1].id : null,
		);
	}
}

export function switchTerminal(id: string): void {
	setActiveTerminalId(id);
}

export function getTerminals() {
	return terminals();
}

export function getActiveTerminalId() {
	return activeTerminalId();
}

/**
 * Send input to a terminal's shell.
 *
 * Previously a stub that only logged. Now the real path, with the stub
 * behaviour retained when the native layer is unavailable so that typing in the
 * renderer does not throw on a host without a build.
 */
export function writeToTerminal(terminalId: string, data: string): void {
	const active = getManager();
	if (active === null) {
		console.log(`[terminal ${terminalId}] write (no pty): ${data}`);
		return;
	}
	active.write(terminalId, data);
}

/** Tell the shell its window changed, so full-screen programs redraw. */
export function resizeTerminal(terminalId: string, cols: number, rows: number): void {
	manager?.resize(terminalId, cols, rows);
}

/** Close every session. Used on teardown so no poll timer outlives the UI. */
export function closeAllTerminals(): void {
	manager?.closeAll();
	subscribers.clear();
}

export function isTerminalLive(id: string): boolean {
	return manager?.has(id) ?? false;
}  
