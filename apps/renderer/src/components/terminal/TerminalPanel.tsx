import { type Component, onCleanup, onMount } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

export type TerminalPanelProps = {
  terminalId: string;
  isActive: boolean;
  onData?: (data: string) => void;
};

export const TerminalPanel: Component<TerminalPanelProps> = props => {
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

    if (props.onData) {
      const disposable = terminal.onData((data: string) => {
        props.onData?.(data);
      });
      onCleanup(() => disposable.dispose());
    }

    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    resizeObserver.observe(ref);
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    terminal?.dispose();
  });

  return (
    <div
      ref={el => (ref = el)}
      style={{
        display: props.isActive ? "block" : "none",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    />
  );
};
