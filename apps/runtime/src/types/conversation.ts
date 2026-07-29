export type MessageMetadata = {
  status?: "pending" | "streaming" | "complete" | "error" | "cancelled";
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  [key: string]: unknown;
};

export type Message = {
  id: string;
  conversationId?: string;
  role: "user" | "assistant" | "system" | "tool_call" | "tool_result";
  content: string;
  timestamp: number | string;
  metadata?: MessageMetadata;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  modelId?: string;
  createdAt: number | string;
  updatedAt: number | string;
  metadata?: Record<string, unknown>;
};
