import type { Conversation, Message } from "../../types/conversation";

export class ConversationStore {
  private filePath: string;
  private conversations: Map<string, Conversation>;

  constructor(filePath: string = "conversations.json") {
    this.filePath = filePath;
    this.conversations = new Map();
  }

  /**
   * Load conversations from persistent storage
   */
  async loadConversations(): Promise<Conversation[]> {
    try {
      // In a real implementation, this would read from Bun.file(this.filePath)
      // For now, we'll return an empty array as a placeholder
      const result = Array.from(this.conversations.values());
      return result;
    } catch (error) {
      console.error(`[ConversationStore] Failed to load conversations:`, error);
      return [];
    }
  }

  /**
   * Save all conversations to persistent storage
   */
  async saveConversations(conversations: Conversation[]): Promise<void> {
    try {
      this.conversations.clear();
      for (const conv of conversations) {
        this.conversations.set(conv.id, conv);
      }
      // In a real implementation, this would write to Bun.file(this.filePath)
      console.log(`[ConversationStore] Saved ${conversations.length} conversations`);
    } catch (error) {
      console.error(`[ConversationStore] Failed to save conversations:`, error);
    }
  }

  /**
   * Save a single conversation
   */
  async saveConversation(conversation: Conversation): Promise<void> {
    try {
      this.conversations.set(conversation.id, conversation);
      // In a real implementation, this would update the persisted file
      console.log(`[ConversationStore] Saved conversation ${conversation.id}`);
    } catch (error) {
      console.error(`[ConversationStore] Failed to save conversation:`, error);
    }
  }

  /**
   * Delete a conversation by ID
   */
  async deleteConversation(id: string): Promise<void> {
    try {
      this.conversations.delete(id);
      // In a real implementation, this would update the persisted file
      console.log(`[ConversationStore] Deleted conversation ${id}`);
    } catch (error) {
      console.error(`[ConversationStore] Failed to delete conversation:`, error);
    }
  }

  /**
   * Get a conversation by ID
   */
  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  /**
   * Get all conversations
   */
  getConversations(): Conversation[] {
    return Array.from(this.conversations.values());
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(conversationId: string, message: Message): Promise<void> {
    try {
      const conv = this.conversations.get(conversationId);
      if (!conv) {
        throw new Error(`Conversation ${conversationId} not found`);
      }
      conv.messages.push(message);
      conv.updatedAt = new Date().toISOString();
      this.conversations.set(conversationId, conv);
      await this.saveConversation(conv);
    } catch (error) {
      console.error(`[ConversationStore] Failed to add message:`, error);
    }
  }

  /**
   * Clear all conversations
   */
  async clearConversations(): Promise<void> {
    try {
      this.conversations.clear();
      // In a real implementation, this would clear the persisted file
      console.log(`[ConversationStore] Cleared all conversations`);
    } catch (error) {
      console.error(`[ConversationStore] Failed to clear conversations:`, error);
    }
  }
}
