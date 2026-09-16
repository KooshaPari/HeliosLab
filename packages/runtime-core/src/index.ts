/**
 * @helios/runtime-core
 *
 * Shared runtime protocol, lanes, sessions, and integration layer.
 * Extracted from heliosApp and heliosApp-colab to eliminate the ~95% duplication
 * between the two repos (runtime/src is 95.4% identical per audit).
 *
 * Phase 2: Actual extraction of types, API client, config, and ID generation.
 *
 * See: docs/plans/heliosapp-consolidation-plan.md
 *
 * wraps: nothing — pure first-party extraction
 */

export const RUNTIME_CORE_VERSION = "0.2.0";

// API client: Anthropic Messages REST API wrapper
export type {
	AnthropicContentBlock,
	AnthropicErrorResponse,
	AnthropicHistoryEntry,
	AnthropicMessagesResponse,
	AnthropicTextBlock,
	SendMessagesOptions,
} from "./api-client.js";
export {
	AnthropicApiError,
	extractTextContent,
	sendMessages,
	toAnthropicHistory,
} from "./api-client.js";
// Config: env-var lookups
export {
	getAnthropicApiKey,
	getAnthropicBaseUrl,
	getDefaultModelId,
	isDev,
} from "./config.js";
// ID generation
export {
	_resetMessageIdCounter,
	generateConversationId,
	generateCorrelationId,
	generateLaneId,
	generateMessageId,
	generateSessionId,
	generateTerminalId,
} from "./id.js";
// Types: conversation, message, protocol envelopes, workspace/lane/session/terminal
export type {
	BaseEnvelope,
	CommandEnvelope,
	Conversation,
	EnvelopeType,
	EventEnvelope,
	Lane,
	LaneState,
	LocalBusEnvelope,
	Message,
	MessageMetadata,
	MessageRole,
	MessageStatus,
	ResponseEnvelope,
	Session,
	Terminal,
	TerminalState,
	Workspace,
	WorkspaceState,
} from "./types.js";
