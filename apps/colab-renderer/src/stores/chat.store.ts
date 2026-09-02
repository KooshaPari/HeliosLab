import { createSignal } from "solid-js";
import type { Conversation, Message } from "@helios/runtime-core";
import {
  generateMessageId,
  generateConversationId,
  sendMessages,
  extractTextContent,
  toAnthropicHistory,
  getAnthropicApiKey,
  getDefaultModelId,
  AnthropicApiError,
} from "@helios/runtime-core";

const [conversations, setConversations] = createSignal<Conversation[]>([]);
const [activeConversationId, setActiveConversationId] = createSignal<string | null>(null);
const [isStreaming, setIsStreaming] = createSignal(false);

export function getConversations(): Conversation[] {
  return conversations();
}

export function getActiveConversation(): Conversation | null {
  const id = activeConversationId();
  if (!id) return null;
  return conversations().find(c => c.id === id) ?? null;
}

export function getIsStreaming(): boolean {
  return isStreaming();
}

export function createConversation(): string {
  const id = generateConversationId();
  const conv: Conversation = {
    id,
    title: "New Conversation",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    modelId: getDefaultModelId(),
    messages: [],
  };
  setConversations((prev: Conversation[]) => [conv, ...prev]);
  setActiveConversationId(id);
  return id;
}

export function setActiveConversation(id: string): void {
  setActiveConversationId(id);
}

export async function sendMessage(text: string): Promise<void> {
  let convId = activeConversationId();
  if (!convId) {
    convId = createConversation();
  }

  const userMsg: Message = {
    id: generateMessageId(),
    conversationId: convId,
    role: "user",
    content: text,
    timestamp: Date.now(),
  };

  const assistantMsg: Message = {
    id: generateMessageId(),
    conversationId: convId,
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    metadata: { status: "streaming" },
  };

  setConversations((prev: Conversation[]) =>
    prev.map(c => {
      if (c.id !== convId) return c;
      return {
        ...c,
        messages: [...c.messages, userMsg, assistantMsg],
        updatedAt: Date.now(),
        title: c.messages.length === 0 ? text.slice(0, 50) : c.title,
      };
    })
  );

  setIsStreaming(true);

  try {
    const apiKey = getAnthropicApiKey();

    if (!apiKey) {
      appendToAssistantMessage(
        convId,
        assistantMsg.id,
        "No API key configured. Set ANTHROPIC_API_KEY environment variable to enable agent chat."
      );
      finalizeAssistantMessage(convId, assistantMsg.id, "complete");
      return;
    }

    const history = toAnthropicHistory(
      (getActiveConversation()?.messages ?? []).filter(m => m.id !== assistantMsg.id)
    );

    const response = await sendMessages({
      model: getDefaultModelId(),
      history,
      apiKey,
    });

    appendToAssistantMessage(convId, assistantMsg.id, extractTextContent(response));
    finalizeAssistantMessage(convId, assistantMsg.id, "complete");
  } catch {
    let errMsg: string;
    if (err instanceof AnthropicApiError) {
      errMsg = `Anthropic API error ${err.status}: ${err.body}`;
    } else {
      errMsg = err instanceof Error ? err.message : String(err);
    }
    appendToAssistantMessage(convId, assistantMsg.id, `Error: ${errMsg}`);
    finalizeAssistantMessage(convId, assistantMsg.id, "error");
  }
}

function appendToAssistantMessage(convId: string, msgId: string, content: string): void {
  setConversations((prev: Conversation[]) =>
    prev.map(c => {
      if (c.id !== convId) return c;
      return {
        ...c,
        messages: c.messages.map(m => {
          if (m.id !== msgId) return m;
          return { ...m, content: m.content + content };
        }),
      };
    })
  );
}

function finalizeAssistantMessage(
  convId: string,
  msgId: string,
  status: "complete" | "error" | "cancelled"
): void {
  setConversations((prev: Conversation[]) =>
    prev.map(c => {
      if (c.id !== convId) return c;
      return {
        ...c,
        messages: c.messages.map(m => {
          if (m.id !== msgId) return m;
          return { ...m, metadata: { ...m.metadata, status } };
        }),
      };
    })
  );
  setIsStreaming(false);
}

export function cancelResponse(): void {
  const conv = getActiveConversation();
  if (!conv) return;
  const lastMsg = conv.messages[conv.messages.length - 1];
  if (lastMsg?.metadata?.status === "streaming") {
    finalizeAssistantMessage(conv.id, lastMsg.id, "cancelled");
  }
}
