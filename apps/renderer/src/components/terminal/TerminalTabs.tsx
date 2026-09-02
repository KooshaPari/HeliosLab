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
      <For each={getTerminals()}>
        {(term: TerminalInfo) => {
          const isActive = () => getActiveTerminalId() === term.id;
          return (
            <div
              role="tab"
              aria-selected={isActive()}
              onClick={() => switchTerminal(term.id)}
              style={{
                display: "flex",
                "align-items": "center",
                gap: "6px",
                padding: "4px 12px",
                cursor: "pointer",
                "background-color": isActive() ? "#1e1e2e" : "transparent",
                color: isActive() ? "#cdd6f4" : "#6c7086",
                "border-right": "1px solid #313244",
                "font-family": '"JetBrains Mono", "Fira Code", monospace',
                "font-size": "12px",
                "white-space": "nowrap",
                "user-select": "none",
              }}
            >
              <span>{term.name}</span>
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
            </div>
          );
        }}
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
