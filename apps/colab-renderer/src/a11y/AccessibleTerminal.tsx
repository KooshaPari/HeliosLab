// apps/colab-renderer/src/a11y/AccessibleTerminal.tsx
// xterm.js screen-reader mode wrapper. The xterm canvas is opaque to
// assistive tech by default; enabling `screenReaderMode: true` causes
// xterm to render a parallel text-only DOM tree that screen readers
// (NVDA, VoiceOver, JAWS) can navigate. Verified in
// e2e/a11y/screen-reader.spec.ts.

import { type Component, onMount, onCleanup } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

interface AccessibleTerminalProps {
  id: string;
  ariaLabel: string;
  onData?: (data: string) => void;
}

export const AccessibleTerminal: Component<AccessibleTerminalProps> = (
  props,
) => {
  let host: HTMLDivElement | undefined;
  let term: Terminal | undefined;

  onMount(() => {
    if (!host) return;
    term = new Terminal({
      screenReaderMode: true,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
      },
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(host);
    fit.fit();
    if (props.onData) {
      term.onData((d) => props.onData?.(d));
    }
  });

  onCleanup(() => {
    term?.dispose();
  });

  return (
    <div
      ref={host}
      id={props.id}
      role="application"
      aria-label={props.ariaLabel}
      class="xterm-host"
    />
  );
};
