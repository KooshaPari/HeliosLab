import { type Component, createSignal } from "solid-js";
import { Show } from "solid-js";
import type { Message } from "../../../../runtime/src/types/conversation";

type ToolResultBlockProps = { message: Message };

export const ToolResultBlock: Component<ToolResultBlockProps> = props => {
  const [expanded, setExpanded] = createSignal(false);
  const isError = () => props.message.metadata?.status === "error";
  const output = () => props.message.metadata?.toolOutput ?? props.message.content;

  return (
    <div
      style={{
        width: "100%",
        border: `1px solid ${isError() ? "#f38ba8" : "#a6e3a1"}`,
        "border-radius": "8px",
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded())}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 12px",
          "background-color": "#181825",
          cursor: "pointer",
          "font-size": "13px",
          color: isError() ? "#f38ba8" : "#a6e3a1",
        }}
      >
        <span>{isError() ? "\u274C" : "\u2705"}</span>
        <span style={{ flex: "1" }}>{isError() ? "Error" : "Result"}</span>
        <span>{expanded() ? "\u25B2" : "\u25BC"}</span>
      </div>
      <Show when={expanded()}>
        <div
          style={{
            padding: "8px 12px",
            "background-color": "#11111b",
            "font-size": "12px",
            "font-family": "monospace",
            color: "#a6adc8",
            "white-space": "pre-wrap",
            "max-height": "300px",
            "overflow-y": "auto",
          }}
        >
          <>{output() ?? ""}</>
        </div>
      </Show>
    </div>
  );
};
