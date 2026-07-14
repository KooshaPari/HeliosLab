import { type Component, For, Show } from "solid-js";

type FileAccess = {
  path: string;
  type: "read" | "write";
  timestamp: number;
};

type FileContextPanelProps = {
  files: FileAccess[];
  isVisible: boolean;
};

export const FileContextPanel: Component<FileContextPanelProps> = props => {
  return (
    <Show when={props.isVisible && props.files.length > 0}>
      <div
        style={{
          width: "250px",
          "border-left": "1px solid #313244",
          "background-color": "#181825",
          padding: "12px",
          "overflow-y": "auto",
        }}
      >
        <h3
          style={{
            color: "#a6adc8",
            "font-size": "12px",
            "text-transform": "uppercase",
            "letter-spacing": "0.5px",
            "margin-bottom": "12px",
          }}
        >
          Files
        </h3>
        <For each={props.files}>
          {file => (
            <div
              style={{
                padding: "6px 8px",
                "border-radius": "4px",
                "margin-bottom": "4px",
                "background-color": "#1e1e2e",
                "font-size": "12px",
              }}
            >
              <div
                style={{
                  color: file.type === "write" ? "#f9e2af" : "#89b4fa",
                  display: "flex",
                  "align-items": "center",
                  gap: "4px",
                }}
              >
                <span>{file.type === "write" ? "\u270F\uFE0F" : "\uD83D\uDC41\uFE0F"}</span>
                <span style={{ "word-break": "break-all" }}>{file.path.split("/").pop()}</span>
              </div>
              <div
                style={{
                  color: "#585b70",
                  "font-size": "11px",
                  "margin-top": "2px",
                }}
              >
                {file.path}
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
};
