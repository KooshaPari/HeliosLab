import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(
	new URL("../../../src/stores/chat.store.ts", import.meta.url),
	"utf8",
);
const compiled = ts.transpileModule(source, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2022,
	},
}).outputText;

class AnthropicApiError extends Error {
	constructor(
		public status: unknown,
		public body: unknown,
		message: string,
	) {
		super(message);
	}
}

for (const [label, error, message] of [
	[
		"API error",
		new AnthropicApiError(429, "rate limited", "request failed"),
		"Anthropic API error 429: rate limited",
	],
	["ordinary error", new Error("offline"), "offline"],
	["string rejection", "network unavailable", "network unavailable"],
	["null rejection", null, "null"],
	[
		"invalid status",
		new AnthropicApiError("429", "body", "invalid status"),
		"invalid status",
	],
	[
		"invalid body",
		new AnthropicApiError(429, null, "invalid body"),
		"invalid body",
	],
]) {
	test(`chat finalizes a failed response for ${label}`, async () => {
		let sequence = 0;
		const api = {
			AnthropicApiError,
			generateMessageId: () => `message-${++sequence}`,
			generateConversationId: () => "conversation",
			getDefaultModelId: () => "test-model",
			getAnthropicApiKey: () => "test-key",
			toAnthropicHistory: () => [],
			sendMessages: async () => {
				throw error;
			},
		};
		const exports: {
			sendMessage: (text: string) => Promise<void>;
			getActiveConversation: () => {
				messages: Array<{
					role: string;
					content: string;
					metadata: { status: string };
				}>;
			};
			getIsStreaming: () => boolean;
		} = runInThisContext(
			`(function(require) { const exports = {}; ${compiled}\n; return exports; })`,
		)((name: string) =>
			name === "@helios/runtime-core" ? api : require(name),
		);
		await exports.sendMessage("hello");
		const response = exports.getActiveConversation().messages.at(-1);
		if (!response) throw new Error("Missing assistant response");
		expect(response.role).toBe("assistant");
		expect(response.content).toBe(`Error: ${message}`);
		expect(response.metadata.status).toBe("error");
		expect(exports.getIsStreaming()).toBe(false);
	});
}
