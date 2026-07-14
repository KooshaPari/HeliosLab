import { describe, it, expect, beforeEach } from "bun:test";
import { ChatTab } from "../../../src/tabs/chat_tab";
import type { ActiveContext } from "../../../src/tabs/context_switch";

describe("ChatTab", () => {
  let tab: ChatTab;

  beforeEach(() => {
    tab = new ChatTab();
  });

  describe("Initialization", () => {
    it("should create with correct properties", () => {
      expect(tab.getTabId()).toBe("chat-tab");
      expect(tab.getTabType()).toBe("chat");
      expect(tab.getLabel()).toBe("Chat");
    });
  });

  describe("Context Binding", () => {
    it("should update on context change", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const _el = tab.render();
      expect(el).toBeDefined();
    });

    it("should clear messages on null context", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      await tab.onContextChange(null);
      const _el = tab.render();

      const state = tab.getState();
      expect(state.messageCount).toBe(0);
    });
  });

  describe("Chat History", () => {
    it("should load chat history on context change", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const state = tab.getState();

      expect(state.messageCount).toBeGreaterThan(0);
    });

    it("should display messages", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const _el = tab.render();

      expect(el.textContent).toContain("Agent");
    });

    it("should show agent and user messages", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const _el = tab.render();

      expect(el.textContent?.toLowerCase()).toContain("you");
    });
  });

  describe("Empty State", () => {
    it("should show empty state when no history", async () => {
      await tab.onContextChange(null);
      const _el = tab.render();

      expect(el.textContent).toContain("No chat history");
    });

    it("should show input prompt in empty state", async () => {
      await tab.onContextChange(null);
      const _el = tab.render();
      const textarea = el.querySelector("textarea");

      expect(textarea).toBeDefined();
    });
  });

  describe("Input Handling", () => {
    it("should have text input field", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const _el = tab.render();
      const input = el.querySelector("textarea");

      expect(input).toBeDefined();
      expect(input?.placeholder).toContain("Type your message");
    });

    it("should have send button", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const _el = tab.render();
      const button = el.querySelector("button");

      expect(button?.textContent).toContain("Send");
    });
  });

  describe("State Persistence", () => {
    it("should serialize state with message count", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const state = tab.getState();

      expect(state.tabType).toBe("chat");
      expect(state.messageCount).toBeGreaterThan(0);
    });

    it("should preserve draft input", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const state = tab.getState();

      expect(state.draftInput).toBeDefined();
    });

    it("should restore state", async () => {
      const context: ActiveContext = {
        workspaceId: "ws1",
        laneId: "lane1",
        sessionId: "session1",
      };

      await tab.onContextChange(context);
      const originalState = tab.getState();

      const newTab = new ChatTab();
      newTab.restoreState(originalState);

      expect(newTab.getState().tabType).toBe(originalState.tabType);
    });
  });

  describe("Lifecycle", () => {
    it("should handle activation and deactivation", () => {
      tab.onActivate();
      expect(tab.getIsActive()).toBe(true);

      tab.onDeactivate();
      expect(tab.getIsActive()).toBe(false);
    });
  });
});
