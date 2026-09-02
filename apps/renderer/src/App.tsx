import { type Component, For, onMount } from "solid-js";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { TerminalTabs } from "./components/terminal/TerminalTabs";
import {
  createTerminal,
  getActiveTerminalId,
  getTerminals,
  writeToTerminal,
} from "./stores/terminal.store";

export const App: Component = () => {
  onMount(() => {
    // Create one terminal by default on startup
    createTerminal();
  });

  return (
    <div
      class="app-root"
      style={{
        "min-height": "100vh",
        "background-color": "#1e1e2e",
        color: "#cdd6f4",
        "font-family": '"JetBrains Mono", "Fira Code", monospace',
        display: "flex",
        "flex-direction": "column",
      }}
    >
      <h1
        style={{
          padding: "8px 16px",
          margin: "0",
          "font-size": "16px",
          "border-bottom": "1px solid #313244",
        }}
      >
        Helios IDE
      </h1>
      <div
        style={{
          flex: "1",
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
        }}
      >
        <TerminalTabs />
        <div style={{ flex: "1", position: "relative", overflow: "hidden" }}>
          <For each={getTerminals()}>
            {term => (
              <TerminalPanel
                terminalId={term.id}
                isActive={getActiveTerminalId() === term.id}
                onData={(data: string) => writeToTerminal(term.id, data)}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
