import { type Component, createSignal } from "solid-js";
import { Show } from "solid-js";
import type { Message } from "../../../../runtime/src/types/conversation";

type ToolCallBlockProps = { message: Message };

export const ToolCallBlock: Component<ToolCallBlockProps> = props => {
  const [expanded, setExpanded] = createSignal(false);
  const toolName = () => props.message.metadata?.toolName ?? "Tool Call";
  const status = () => props.message.metadata?.status ?? "complete";
  const input = () => props.message.metadata?.toolInput;

  const statusIcon = () => {
    switch (status()) {
      case "pending":
      case "streaming":
        return "\u23F3";
      case "complete":
        return "\u2705";
      case "error":
        return "\u274C";
      default:
        return "\u2139\uFE0F";
    }
  };

  return (
    <div
      style={{
        width: "100%",
        border: "1px solid #313244",
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
          color: "#a6adc8",
        }}
      >
        <span>{statusIcon()}</span>
        <span style={{ flex: "1" }}>{toolName()}</span>
        <span>{expanded() ? "\u25B2" : "\u25BC"}</span>
      </div>
      <Show when={expanded() && input() !== undefined}>
        <div
          style={{
            padding: "8px 12px",
            "background-color": "#11111b",
            "font-size": "12px",
            "font-family": "monospace",
            color: "#a6adc8",
            "white-space": "pre-wrap",
            "max-height": "200px",
            "overflow-y": "auto",
          }}
        >
          <>{JSON.stringify(input(), null, 2)}</>
        </div>
      </Show>
    </div>
  );
};
