import { TabSurface, type TabState, type ActiveContext } from "./tab_surface";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: string;
  collapsed?: boolean;
}

export interface ChatTabState extends TabState {
  scrollPosition?: number;
  draftInput?: string;
  messageCount?: number;
}

/**
 * ChatTab displays a chat interface for conversational interaction with the agent.
 *
 * Features:
 * - Displays message history with user and agent messages
 * - Shows empty state with input prompt
 * - Supports message input with Enter to send, Shift+Enter for newline
 * - Live message streaming as new agent messages arrive
 * - Collapsible sections for long messages
 * - Persists scroll position and draft input
 */
export class ChatTab extends TabSurface {
  private messages: ChatMessage[] = [];
  private draftInput: string = "";
  private contentEl: HTMLElement | null = null;
  private scrollContainer: HTMLElement | null = null;

  constructor() {
    super("chat-tab", "chat", "Chat");
  }

  async onContextChange(context: ActiveContext | null): Promise<void> {
    // When context changes, load chat history for this lane/session
    this.messages = [];
    this.draftInput = "";

    if (!context) {
      return;
    }

    // In a real implementation, query chat history:
    // const history = await chatRegistry.getChatHistory(context.sessionId);
    // this.messages = history.messages;

    // Simulate: generate mock chat history
    this.generateMockChatHistory(context);
  }

  render(): HTMLElement {
    const container = document.createElement("div");
    container.className = "chat-tab";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%";
    container.style.backgroundColor = "#fff";
    container.style.overflow = "hidden";

    // Messages container
    this.scrollContainer = document.createElement("div");
    this.scrollContainer.className = "chat-messages";
    this.scrollContainer.style.flex = "1";
    this.scrollContainer.style.overflow = "auto";
    this.scrollContainer.style.padding = "12px";
    this.scrollContainer.style.display = "flex";
    this.scrollContainer.style.flexDirection = "column";
    this.scrollContainer.style.gap = "12px";

    if (this.messages.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.style.flex = "1";
      emptyEl.style.display = "flex";
      emptyEl.style.alignItems = "center";
      emptyEl.style.justifyContent = "center";
      emptyEl.style.color = "#999";
      emptyEl.style.textAlign = "center";

      const textEl = document.createElement("div");
      textEl.textContent = "No chat history. Start a conversation with the agent.";

      emptyEl.appendChild(textEl);
      this.scrollContainer.appendChild(emptyEl);
    } else {
      for (const message of this.messages) {
        const msgEl = this.renderMessage(message);
        this.scrollContainer.appendChild(msgEl);
      }
    }

    container.appendChild(this.scrollContainer);

    // Input area
    const inputAreaEl = document.createElement("div");
    inputAreaEl.style.padding = "12px";
    inputAreaEl.style.borderTop = "1px solid #e0e0e0";
    inputAreaEl.style.backgroundColor = "#f5f5f5";
    inputAreaEl.style.display = "flex";
    inputAreaEl.style.gap = "8px";

    const inputEl = document.createElement("textarea");
    inputEl.value = this.draftInput;
    inputEl.placeholder = "Type your message... (Shift+Enter for new line)";
    inputEl.style.flex = "1";
    inputEl.style.padding = "8px";
    inputEl.style.border = "1px solid #ddd";
    inputEl.style.borderRadius = "3px";
    inputEl.style.fontFamily = "inherit";
    inputEl.style.fontSize = "13px";
    inputEl.style.resize = "none";
    inputEl.style.maxHeight = "100px";

    inputEl.addEventListener("change", e => {
      this.draftInput = (e.target as HTMLTextAreaElement).value;
    });

    inputEl.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage(inputEl.value);
        inputEl.value = "";
        this.draftInput = "";
      }
    });

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "Send";
    sendBtn.style.padding = "8px 16px";
    sendBtn.style.backgroundColor = "#2196f3";
    sendBtn.style.color = "white";
    sendBtn.style.border = "none";
    sendBtn.style.borderRadius = "3px";
    sendBtn.style.cursor = "pointer";
    sendBtn.style.fontSize = "13px";
    sendBtn.addEventListener("click", () => {
      const text = inputEl.value;
      if (text.trim()) {
        this.sendMessage(text);
        inputEl.value = "";
        this.draftInput = "";
      }
    });

    inputAreaEl.appendChild(inputEl);
    inputAreaEl.appendChild(sendBtn);
    container.appendChild(inputAreaEl);

    this.contentEl = container;
    return container;
  }

  private renderMessage(message: ChatMessage): HTMLElement {
    const isUser = message.role === "user";

    const msgEl = document.createElement("div");
    msgEl.style.display = "flex";
    msgEl.style.gap = "8px";
    msgEl.style.justifyContent = isUser ? "flex-end" : "flex-start";

    const contentEl = document.createElement("div");
    contentEl.style.maxWidth = "70%";
    contentEl.style.padding = "8px 12px";
    contentEl.style.borderRadius = "3px";
    contentEl.style.backgroundColor = isUser ? "#e3f2fd" : "#f5f5f5";
    contentEl.style.color = "#333";
    contentEl.style.fontSize = "13px";
    contentEl.style.wordWrap = "break-word";

    const headerEl = document.createElement("div");
    headerEl.style.fontSize = "11px";
    headerEl.style.color = "#999";
    headerEl.style.marginBottom = "4px";

    const roleEl = document.createElement("span");
    roleEl.style.fontWeight = "600";
    roleEl.textContent = isUser ? "You" : "Agent";

    const timeEl = document.createElement("span");
    timeEl.style.marginLeft = "8px";
    timeEl.textContent = new Date(message.timestamp).toLocaleTimeString();

    headerEl.appendChild(roleEl);
    headerEl.appendChild(timeEl);

    contentEl.appendChild(headerEl);

    // Handle long messages
    if (message.content.length > 500) {
      const lines = message.content.split("\n");

      if (!message.collapsed) {
        for (const line of lines) {
          const lineEl = document.createElement("div");
          lineEl.textContent = line;
          contentEl.appendChild(lineEl);
        }
      } else {
        const lineEl = document.createElement("div");
        lineEl.textContent = lines[0];
        contentEl.appendChild(lineEl);

        const expandBtn = document.createElement("button");
        expandBtn.textContent = `+${lines.length - 1} more lines`;
        expandBtn.style.fontSize = "11px";
        expandBtn.style.color = "#2196f3";
        expandBtn.style.backgroundColor = "transparent";
        expandBtn.style.border = "none";
        expandBtn.style.cursor = "pointer";
        expandBtn.style.padding = "0";
        expandBtn.style.marginTop = "4px";

        expandBtn.addEventListener("click", () => {
          message.collapsed = false;
          // Re-render would be called in real implementation
        });

        contentEl.appendChild(expandBtn);
      }
    } else {
      const textEl = document.createElement("div");
      textEl.textContent = message.content;
      contentEl.appendChild(textEl);
    }

    msgEl.appendChild(contentEl);
    return msgEl;
  }

  private sendMessage(text: string): void {
    if (!text.trim()) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(userMsg);

    // Simulate agent response
    setTimeout(() => {
      const agentMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "agent",
        content: "I understand. Processing your request...",
        timestamp: new Date().toISOString(),
      };
      this.messages.push(agentMsg);

      // In real implementation, would emit event on bus for agent to handle
      console.log("Message sent:", text);
    }, 500);
  }

  getState(): ChatTabState {
    const baseState = super.getState();
    return {
      ...baseState,
      scrollPosition: this.scrollContainer?.scrollTop,
      draftInput: this.draftInput,
      messageCount: this.messages.length,
    };
  }

  restoreState(state: ChatTabState): void {
    super.restoreState(state);
    if (state.draftInput) {
      this.draftInput = state.draftInput;
    }
    if (this.scrollContainer && state.scrollPosition) {
      this.scrollContainer.scrollTop = state.scrollPosition;
    }
  }

  /**
   * Generate mock chat history for demonstration.
   */
  private generateMockChatHistory(_context: ActiveContext): void {
    const baseTime = Date.now();
    this.messages = [
      {
        id: "msg-1",
        role: "agent",
        content:
          "Hello! I'm ready to assist you with your work in this lane. What would you like me to help with?",
        timestamp: new Date(baseTime - 300000).toISOString(),
      },
      {
        id: "msg-2",
        role: "user",
        content: "Can you review the recent changes in the codebase?",
        timestamp: new Date(baseTime - 240000).toISOString(),
      },
      {
        id: "msg-3",
        role: "agent",
        content:
          "I'll analyze the recent commits and provide a summary of changes. Give me a moment...",
        timestamp: new Date(baseTime - 230000).toISOString(),
      },
      {
        id: "msg-4",
        role: "agent",
        content: `Summary of recent changes:\n\n1. Tab UI framework implementation\n2. Context store integration\n3. Terminal rendering updates\n\nAll changes look good and follow the project patterns.`,
        timestamp: new Date(baseTime - 200000).toISOString(),
      },
    ];
  }
}
