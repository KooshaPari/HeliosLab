import { type Component, For, Show } from "solid-js";

type DiffLine = {
  type: "add" | "remove" | "context";
  content: string;
  lineNumber: number;
};

type DiffViewProps = {
  fileName: string;
  lines: DiffLine[];
  onAccept?: () => void;
  onReject?: () => void;
};

export const DiffView: Component<DiffViewProps> = props => {
  const lineColor = (type: string) => {
    if (type === "add") return { bg: "rgba(166,227,161,0.1)", color: "#a6e3a1" };
    if (type === "remove") return { bg: "rgba(243,139,168,0.1)", color: "#f38ba8" };
    return { bg: "transparent", color: "#a6adc8" };
  };

  return (
    <div
      style={{
        border: "1px solid #313244",
        "border-radius": "8px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          padding: "8px 12px",
          "background-color": "#181825",
          "border-bottom": "1px solid #313244",
        }}
      >
        <span style={{ color: "#cdd6f4", "font-size": "13px" }}>{props.fileName}</span>
        <div style={{ display: "flex", gap: "8px" }}>
          <Show when={props.onAccept}>
            <button
              onClick={props.onAccept}
              style={{
                background: "#a6e3a1",
                border: "none",
                color: "#1e1e2e",
                "border-radius": "4px",
                padding: "4px 10px",
                cursor: "pointer",
                "font-size": "12px",
              }}
            >
              Accept
            </button>
          </Show>
          <Show when={props.onReject}>
            <button
              onClick={props.onReject}
              style={{
                background: "#f38ba8",
                border: "none",
                color: "#1e1e2e",
                "border-radius": "4px",
                padding: "4px 10px",
                cursor: "pointer",
                "font-size": "12px",
              }}
            >
              Reject
            </button>
          </Show>
        </div>
      </div>
      <div
        style={{
          "font-family": "monospace",
          "font-size": "12px",
          "overflow-x": "auto",
        }}
      >
        <For each={props.lines}>
          {line => {
            const style = lineColor(line.type);
            return (
              <div
                style={{
                  display: "flex",
                  "background-color": style.bg,
                  "border-left": `3px solid ${line.type === "context" ? "transparent" : style.color}`,
                }}
              >
                <span
                  style={{
                    width: "40px",
                    "text-align": "right",
                    padding: "0 8px",
                    color: "#585b70",
                    "user-select": "none",
                  }}
                >
                  {line.lineNumber}
                </span>
                <span
                  style={{
                    padding: "0 8px",
                    color: style.color,
                    "white-space": "pre",
                  }}
                >
                  {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                  {line.content}
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};
