import type { Component } from "solid-js";
import { For } from "solid-js";
import { ConversationItem } from "./ConversationItem";
import { getAppState, newChat, updateAppState } from "../../stores/app.store";

type MockConversation = {
  id: string;
  title: string;
  updatedAt: Date;
};

const MOCK_CONVERSATIONS: MockConversation[] = [
  {
    id: "conv-1",
    title: "Debug memory leak in Rust PTY manager",
    updatedAt: new Date(Date.now() - 2 * 60 * 1000),
  },
  {
    id: "conv-2",
    title: "Implement WebSocket reconnection logic",
    updatedAt: new Date(Date.now() - 75 * 60 * 1000),
  },
  {
    id: "conv-3",
    title: "Refactor inference engine registry",
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  },
];

export const Sidebar: Component = () => {
  const state = getAppState;

  function handleConversationClick(id: string): void {
    updateAppState({ activeConversationId: id });
  }

  return (
    <div
      style={{
        width: "260px",
        "min-width": "260px",
        "background-color": "#181825",
        display: "flex",
        "flex-direction": "column",
        "border-right": "1px solid #313244",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 10px",
          "border-bottom": "1px solid #313244",
        }}
      >
        <button
          onClick={newChat}
          style={{
            width: "100%",
            padding: "8px 12px",
            "background-color": "#89b4fa",
            color: "#1e1e2e",
            border: "none",
            "border-radius": "6px",
            "font-size": "13px",
            "font-weight": "600",
            cursor: "pointer",
            "font-family": "inherit",
            transition: "background-color 0.15s ease",
          }}
        >
          + New Chat
        </button>
      </div>
      <div
        style={{
          flex: "1",
          "overflow-y": "auto",
          padding: "8px 4px",
        }}
      >
        <For each={MOCK_CONVERSATIONS}>
          {conv => (
            <ConversationItem
              id={conv.id}
              title={conv.title}
              updatedAt={conv.updatedAt}
              isActive={state().activeConversationId === conv.id}
              onClick={handleConversationClick}
            />
          )}
        </For>
      </div>
    </div>
  );
};
