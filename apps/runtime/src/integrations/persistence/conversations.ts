import { rename, writeFile } from "node:fs/promises";
import type { Conversation, Message } from "../../types/conversation";

/**
 * Persistent conversation store backed by a JSON file.
 *
 * - Writes are atomic: data goes to a temp file, then is renamed over the target.
 * - Writes are serialized through a promise queue, so overlapping saves land in order.
 * - A corrupt or non-array file is moved aside (never silently overwritten) and
 *   the load fails loudly.
 * - Write failures propagate to the caller.
 *
 * The supplied `filePath` is honored on every load/save.
 */
export class ConversationStore {
	private conversations: Map<string, Conversation>;
	private filePath: string;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(filePath: string = "conversations.json") {
		this.filePath = filePath;
		this.conversations = new Map();
	}

	/** Move an unreadable store file aside so the next save cannot destroy it. */
	private async quarantine(reason: string): Promise<string> {
		const aside = `${this.filePath}.corrupt-${Date.now()}`;
		await rename(this.filePath, aside);
		console.error(
			`[ConversationStore] ${reason} in ${this.filePath}; moved to ${aside}`,
		);
		return aside;
	}

	/**
	 * Load conversations from persistent storage.
	 * A missing file is an empty store. A corrupt or non-array file is moved
	 * aside and an error is thrown.
	 */
	async loadConversations(): Promise<Conversation[]> {
		const file = Bun.file(this.filePath);
		if (!(await file.exists())) {
			this.conversations = new Map();
			return [];
		}
		let raw: unknown;
		try {
			raw = await file.json();
		} catch (error) {
			const aside = await this.quarantine("Invalid JSON");
			throw new Error(
				`ConversationStore: ${this.filePath} is not valid JSON (moved to ${aside}): ${String(error)}`,
			);
		}
		if (!Array.isArray(raw)) {
			const aside = await this.quarantine("Expected an array");
			throw new Error(
				`ConversationStore: ${this.filePath} is not a conversation array (moved to ${aside})`,
			);
		}
		const list = raw as Conversation[];
		this.conversations = new Map(list.map((c) => [c.id, c]));
		return Array.from(this.conversations.values());
	}

	/** Atomically write the current in-memory set, one write at a time. */
	private persist(): Promise<void> {
		const run = async () => {
			const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
			const data = JSON.stringify(
				Array.from(this.conversations.values()),
				null,
				2,
			);
			await writeFile(tmp, data);
			await rename(tmp, this.filePath);
		};
		const next = this.writeQueue.then(run, run);
		// Keep the chain alive after a failure; the caller still sees the error.
		this.writeQueue = next.catch(() => undefined);
		return next;
	}

	/**
	 * Save all conversations to persistent storage.
	 */
	async saveConversations(conversations: Conversation[]): Promise<void> {
		this.conversations = new Map(conversations.map((c) => [c.id, c]));
		await this.persist();
	}

	/**
	 * Save a single conversation, then persist the full set to disk.
	 */
	async saveConversation(conversation: Conversation): Promise<void> {
		this.conversations.set(conversation.id, conversation);
		await this.persist();
	}

	/**
	 * Delete a conversation by ID, then persist the remaining set to disk.
	 */
	async deleteConversation(id: string): Promise<void> {
		this.conversations.delete(id);
		await this.persist();
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
		const conv = this.conversations.get(conversationId);
		if (!conv) {
			throw new Error(`Conversation ${conversationId} not found`);
		}
		conv.messages.push(message);
		conv.updatedAt = new Date().toISOString();
		this.conversations.set(conversationId, conv);
		await this.persist();
	}

	/**
	 * Clear all conversations and persist the empty state to disk.
	 */
	async clearConversations(): Promise<void> {
		this.conversations.clear();
		await this.persist();
	}
}
