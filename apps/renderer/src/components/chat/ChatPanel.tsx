import { type Component, For, Show, createEffect } from "solid-js";
import type { Message } from "../../../../runtime/src/types/conversation";
import { MessageBubble } from "./MessageBubble";

type ChatPanelProps = {
  messages: Message[];
  isStreaming: boolean;
};

export const ChatPanel: Component<ChatPanelProps> = props => {
  let containerRef: HTMLDivElement | undefined;

  // Auto-scroll to bottom on new messages
  createEffect(() => {
    const _ = props.messages.length;
    if (containerRef) {
      requestAnimationFrame(() => {
        containerRef!.scrollTop = containerRef!.scrollHeight;
      });
    }
  });

  return (
    <div
      ref={(el: HTMLDivElement) => {
        containerRef = el;
      }}
      style={{
        flex: "1",
        "overflow-y": "auto",
        padding: "16px",
        display: "flex",
        "flex-direction": "column",
        gap: "12px",
      }}
    >
      <Show when={props.messages.length === 0}>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "center",
            flex: "1",
            color: "#6c7086",
            "text-align": "center",
            padding: "48px",
          }}
        >
          <h2
            style={{
              "font-size": "24px",
              "margin-bottom": "8px",
              color: "#cdd6f4",
            }}
          >
            How can I help you today?
          </h2>
          <p style={{ "font-size": "14px" }}>
            Ask me to write code, debug issues, or explain concepts.
          </p>
        </div>
      </Show>
      <For each={props.messages}>{message => <MessageBubble message={message} />}</For>
    </div>
  );
};
