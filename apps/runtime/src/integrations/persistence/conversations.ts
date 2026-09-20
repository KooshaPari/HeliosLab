import type { Conversation, Message } from "../../types/conversation";

/**
 * Persistent conversation store backed by a JSON file.
 *
 * Uses Bun's atomic file APIs for safe concurrent reads and writes:
 * - `Bun.file(path).json()` reads a JSON file (returns null if missing)
 * - `Bun.write(path, data)` atomically replaces a file's contents
 *
 * The supplied `filePath` is honored on every load/save, so callers that
 * pass a custom path no longer lose data on restart.
 */
export class ConversationStore {
	private conversations: Map<string, Conversation>;
	private filePath: string;

	constructor(filePath: string = "conversations.json") {
		this.filePath = filePath;
		this.conversations = new Map();
	}

	/**
	 * Load conversations from persistent storage.
	 * Missing file or invalid JSON is treated as an empty store.
	 */
	async loadConversations(): Promise<Conversation[]> {
		try {
			const file = Bun.file(this.filePath);
			if (!(await file.exists())) {
				this.conversations = new Map();
				return [];
			}
			const raw = (await file.json()) as Conversation[] | undefined;
			const list = Array.isArray(raw) ? raw : [];
			this.conversations = new Map(list.map((c) => [c.id, c]));
			return Array.from(this.conversations.values());
		} catch (error) {
			console.error(
				`[ConversationStore] Failed to load conversations from ${this.filePath}:`,
				error,
			);
			return [];
		}
	}

	/**
	 * Save all conversations to persistent storage.
	 */
	async saveConversations(conversations: Conversation[]): Promise<void> {
		try {
			this.conversations = new Map(conversations.map((c) => [c.id, c]));
			await Bun.write(
				this.filePath,
				JSON.stringify(Array.from(this.conversations.values()), null, 2),
			);
		} catch (error) {
			console.error(
				`[ConversationStore] Failed to save conversations to ${this.filePath}:`,
				error,
			);
		}
	}

	/**
	 * Save a single conversation, then persist the full set to disk.
	 */
	async saveConversation(conversation: Conversation): Promise<void> {
		try {
			this.conversations.set(conversation.id, conversation);
			await this.saveConversations(Array.from(this.conversations.values()));
		} catch (error) {
			console.error(
				`[ConversationStore] Failed to save conversation ${conversation.id}:`,
				error,
			);
		}
	}

	/**
	 * Delete a conversation by ID, then persist the remaining set to disk.
	 */
	async deleteConversation(id: string): Promise<void> {
		try {
			this.conversations.delete(id);
			await this.saveConversations(Array.from(this.conversations.values()));
		} catch (error) {
			console.error(
				`[ConversationStore] Failed to delete conversation ${id}:`,
				error,
			);
		}
	}

	/**
	 * Get a conversation by ID.
	 */
	getConversation(id: string): Conversation | undefined {
		return this.conversations.get(id);
	}

	/**
	 * Get all in-memory conversations.
	 */
	getConversations(): Conversation[] {
		return Array.from(this.conversations.values());
	}

	/**
	 * Add a message to a conversation and persist to disk.
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
			console.error(
				`[ConversationStore] Failed to add message to ${conversationId}:`,
				error,
			);
		}
	}

	/**
	 * Clear all conversations and persist the empty state to disk.
	 */
	async clearConversations(): Promise<void> {
		try {
			this.conversations.clear();
			await Bun.write(this.filePath, "[]");
		} catch (error) {
			console.error(
				`[ConversationStore] Failed to clear conversations:`,
				error,
			);
		}
	}
}
