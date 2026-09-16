import { createSignal } from "solid-js";
import type {
	Conversation,
	Message,
} from "../../../runtime/src/types/conversation";

const [conversations, setConversations] = createSignal<Conversation[]>([]);
const [activeConversationId, setActiveConversationId] = createSignal<
	string | null
>(null);
const [isStreaming, setIsStreaming] = createSignal(false);

let messageIdCounter = 0;

function generateId(): string {
	return `msg-${Date.now()}-${++messageIdCounter}`;
}

export function getConversations(): Conversation[] {
	return conversations();
}

export function getActiveConversation(): Conversation | null {
	const id = activeConversationId();
	if (!id) return null;
	return conversations().find((c) => c.id === id) ?? null;
}

export function getIsStreaming(): boolean {
	return isStreaming();
}

export function createConversation(): string {
	const id = `conv-${Date.now()}`;
	const conv: Conversation = {
		id,
		title: "New Conversation",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		modelId: "claude-sonnet-4-20250514",
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

	// Add user message
	const userMsg: Message = {
		id: generateId(),
		conversationId: convId,
		role: "user",
		content: text,
		timestamp: Date.now(),
	};

	// Add placeholder assistant message
	const assistantMsg: Message = {
		id: generateId(),
		conversationId: convId,
		role: "assistant",
		content: "",
		timestamp: Date.now(),
		metadata: { status: "streaming" },
	};

	setConversations((prev: Conversation[]) =>
		prev.map((c) => {
			if (c.id !== convId) return c;
			return {
				...c,
				messages: [...c.messages, userMsg, assistantMsg],
				updatedAt: Date.now(),
				title: c.messages.length === 0 ? text.slice(0, 50) : c.title,
			};
		}),
	);

	setIsStreaming(true);

	try {
		// Call the inference engine via the runtime bridge
		// For now, use a direct fetch to Anthropic API as a placeholder
		// This will be replaced with proper RPC wiring when ElectroBun is integrated
		const apiKey =
			typeof process !== "undefined"
				? (process.env?.ANTHROPIC_API_KEY ??
					process.env?.HELIOS_ACP_API_KEY ??
					"")
				: "";

		if (!apiKey) {
			appendToAssistantMessage(
				convId,
				assistantMsg.id,
				"No API key configured. Set ANTHROPIC_API_KEY environment variable to enable agent chat.",
			);
			finalizeAssistantMessage(convId, assistantMsg.id, "complete");
			return;
		}

		const history =
			getActiveConversation()
				?.messages.filter((m) => m.role === "user" || m.role === "assistant")
				.filter((m) => m.id !== assistantMsg.id)
				.map((m) => ({ role: m.role, content: m.content })) ?? [];

		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: "claude-sonnet-4-20250514",
				max_tokens: 4096,
				messages: history,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			appendToAssistantMessage(
				convId,
				assistantMsg.id,
				`Error: ${response.status} - ${errorText}`,
			);
			finalizeAssistantMessage(convId, assistantMsg.id, "error");
			return;
		}

		const data = (await response.json()) as {
			content: Array<{ type: string; text: string }>;
			usage: { input_tokens: number; output_tokens: number };
		};
		const content = data.content
			.filter((c: { type: string }) => c.type === "text")
			.map((c: { text: string }) => c.text)
			.join("");

		appendToAssistantMessage(convId, assistantMsg.id, content);
		finalizeAssistantMessage(convId, assistantMsg.id, "complete");
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		appendToAssistantMessage(convId, assistantMsg.id, `Error: ${errMsg}`);
		finalizeAssistantMessage(convId, assistantMsg.id, "error");
	}
}

function appendToAssistantMessage(
	convId: string,
	msgId: string,
	content: string,
): void {
	setConversations((prev: Conversation[]) =>
		prev.map((c) => {
			if (c.id !== convId) return c;
			return {
				...c,
				messages: c.messages.map((m) => {
					if (m.id !== msgId) return m;
					return { ...m, content: m.content + content };
				}),
			};
		}),
	);
}

function finalizeAssistantMessage(
	convId: string,
	msgId: string,
	status: "complete" | "error" | "cancelled",
): void {
	setConversations((prev: Conversation[]) =>
		prev.map((c) => {
			if (c.id !== convId) return c;
			return {
				...c,
				messages: c.messages.map((m) => {
					if (m.id !== msgId) return m;
					return { ...m, metadata: { ...m.metadata, status } };
				}),
			};
		}),
	);
	setIsStreaming(false);
}

export function cancelResponse(): void {
	// TODO: AbortController integration for cancelling in-flight requests
	const conv = getActiveConversation();
	if (!conv) return;
	const lastMsg = conv.messages[conv.messages.length - 1];
	if (lastMsg?.metadata?.status === "streaming") {
		finalizeAssistantMessage(conv.id, lastMsg.id, "cancelled");
	}
}
