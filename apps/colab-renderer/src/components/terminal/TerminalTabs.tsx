import { type Component, For } from "solid-js";
import {
  type TerminalInfo,
  closeTerminal,
  createTerminal,
  getActiveTerminalId,
  getTerminals,
  switchTerminal,
} from "../../stores/terminal.store";

export type TerminalTabsProps = {
  onTerminalCreate?: (id: string) => void;
  onTerminalClose?: (id: string) => void;
};

export const TerminalTabs: Component<TerminalTabsProps> = props => {
  const handleAdd = () => {
    const id = createTerminal();
    props.onTerminalCreate?.(id);
  };

  const handleClose = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    closeTerminal(id);
    props.onTerminalClose?.(id);
  };

  return (
    <div
      role="toolbar"
      aria-label="Terminal controls"
      style={{
        display: "flex",
        "flex-direction": "row",
        "align-items": "center",
        "background-color": "#181825",
        "border-bottom": "1px solid #313244",
        "overflow-x": "auto",
        "min-height": "32px",
      }}
    >
      <div role="tablist" aria-label="Terminal sessions" style={{ display: "flex" }}>
        <For each={getTerminals()}>
          {(term: TerminalInfo) => {
            const isActive = () => getActiveTerminalId() === term.id;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={isActive()}
                onClick={() => switchTerminal(term.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: isActive() ? "#cdd6f4" : "#6c7086",
                  cursor: "pointer",
                  padding: "4px 6px 4px 12px",
                  "font-family": '"JetBrains Mono", "Fira Code", monospace',
                  "font-size": "12px",
                  "white-space": "nowrap",
                  "user-select": "none",
                  "background-color": isActive() ? "#1e1e2e" : "transparent",
                  "border-right": "1px solid #313244",
                }}
              >
                {term.name}
              </button>
            );
          }}
        </For>
      </div>
      <For each={getTerminals()}>
        {(term: TerminalInfo) => (
          <button
            type="button"
            onClick={(e: MouseEvent) => handleClose(e, term.id)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "0 2px",
              "font-size": "12px",
              "line-height": "1",
              opacity: "0.7",
            }}
            aria-label={`Close ${term.name}`}
          >
            X
          </button>
        )}
      </For>
      <button
        type="button"
        onClick={handleAdd}
        style={{
          background: "none",
          border: "none",
          color: "#6c7086",
          cursor: "pointer",
          padding: "4px 10px",
          "font-size": "16px",
          "line-height": "1",
          "flex-shrink": "0",
        }}
        aria-label="New terminal"
      >
        +
      </button>
    </div>
  );
};
