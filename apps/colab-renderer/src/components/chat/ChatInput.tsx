import { type Component, createSignal } from "solid-js";
import { Show } from "solid-js";

type ChatInputProps = {
  onSend: (text: string) => void;
  onCancel?: () => void;
  isStreaming: boolean;
  activeModel: string;
};

export const ChatInput: Component<ChatInputProps> = props => {
  const [text, setText] = createSignal("");

  const handleSend = () => {
    const t = text().trim();
    if (t && !props.isStreaming) {
      props.onSend(t);
      setText("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        padding: "12px 16px",
        "border-top": "1px solid #313244",
        "background-color": "#1e1e2e",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "flex-end",
          gap: "8px",
          "background-color": "#313244",
          "border-radius": "12px",
          padding: "8px 12px",
        }}
      >
        <div
          style={{
            "font-size": "12px",
            color: "#6c7086",
            "padding-bottom": "4px",
            "white-space": "nowrap",
          }}
        >
          {props.activeModel.split("/").pop()?.split("-").slice(0, 2).join(" ") ??
            props.activeModel}
        </div>
        <textarea
          value={text()}
          onInput={e => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          disabled={props.isStreaming}
          rows={1}
          style={{
            flex: "1",
            background: "none",
            border: "none",
            outline: "none",
            color: "#cdd6f4",
            "font-size": "14px",
            "font-family": "inherit",
            resize: "none",
            "min-height": "24px",
            "max-height": "160px",
          }}
        />
        <Show
          when={props.isStreaming}
          fallback={
            <button
              onClick={handleSend}
              disabled={!text().trim()}
              style={{
                background: text().trim() ? "#89b4fa" : "#45475a",
                border: "none",
                color: text().trim() ? "#1e1e2e" : "#6c7086",
                "border-radius": "8px",
                padding: "6px 12px",
                cursor: text().trim() ? "pointer" : "default",
                "font-size": "14px",
                "font-weight": "bold",
              }}
            >
              Send
            </button>
          }
        >
          <button
            onClick={() => props.onCancel?.()}
            style={{
              background: "#f38ba8",
              border: "none",
              color: "#1e1e2e",
              "border-radius": "8px",
              padding: "6px 12px",
              cursor: "pointer",
              "font-size": "14px",
              "font-weight": "bold",
            }}
          >
            Stop
          </button>
        </Show>
      </div>
    </div>
  );
};
