import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { type Component, onCleanup, onMount } from "solid-js";
import {
	resizeTerminal,
	subscribeToTerminal,
	writeToTerminal,
} from "../../stores/terminal.store.ts";
import { reportTerminalSize, wireTerminal } from "./panel-wiring.ts";

export type TerminalPanelProps = {
	terminalId: string;
	isActive: boolean;
	onData?: (data: string) => void;
};

export const TerminalPanel: Component<TerminalPanelProps> = (props) => {
	let ref: HTMLDivElement | undefined;
	let terminal: Terminal | undefined;
	let fitAddon: FitAddon | undefined;
	let resizeObserver: ResizeObserver | undefined;

	onMount(() => {
		if (!ref) return;

		terminal = new Terminal({
			theme: {
				background: "#11111b",
				foreground: "#cdd6f4",
				cursor: "#cdd6f4",
			},
			cursorStyle: "block",
			cursorBlink: true,
			fontFamily: '"JetBrains Mono", "Fira Code", monospace',
			fontSize: 14,
			scrollback: 5000,
		});

		fitAddon = new FitAddon();
		const webLinksAddon = new WebLinksAddon();

		terminal.loadAddon(fitAddon);
		terminal.loadAddon(webLinksAddon);
		terminal.open(ref);

		// Delay fit to ensure container has dimensions
		requestAnimationFrame(() => {
			fitAddon?.fit();
		});

		// The wiring lives in panel-wiring.ts so it can be tested; this is only
		// the DOM glue. props.onData stays an observer rather than the input path,
		// so the panel works on its own and existing callers keep working.
		const deps = {
			subscribeToTerminal,
			writeToTerminal: (id: string, data: string) => {
				writeToTerminal(id, data);
				props.onData?.(data);
			},
			resizeTerminal,
		};

		const wiring = wireTerminal(props.terminalId, terminal, deps);
		onCleanup(() => wiring.dispose());

		resizeObserver = new ResizeObserver(() => {
			fitAddon?.fit();
			// Tell the kernel, otherwise full-screen programs keep drawing at the
			// old size. fit() alone only changes what xterm renders.
			if (terminal) reportTerminalSize(props.terminalId, terminal, deps);
		});
		resizeObserver.observe(ref);
	});

	onCleanup(() => {
		resizeObserver?.disconnect();
		terminal?.dispose();
	});

	return (
		<div
			ref={(el) => (ref = el)}
			style={{
				display: props.isActive ? "block" : "none",
				width: "100%",
				height: "100%",
				overflow: "hidden",
			}}
		/>
	);
};
