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

// Types: conversation, message, protocol envelopes, workspace/lane/session/terminal
export type {
  MessageStatus,
  MessageRole,
  MessageMetadata,
  Message,
  Conversation,
  EnvelopeType,
  BaseEnvelope,
  CommandEnvelope,
  ResponseEnvelope,
  EventEnvelope,
  LocalBusEnvelope,
  WorkspaceState,
  LaneState,
  TerminalState,
  Workspace,
  Lane,
  Session,
  Terminal,
} from "./types.js";

// API client: Anthropic Messages REST API wrapper
export type {
  AnthropicHistoryEntry,
  AnthropicTextBlock,
  AnthropicContentBlock,
  AnthropicMessagesResponse,
  AnthropicErrorResponse,
  SendMessagesOptions,
} from "./api-client.js";

export {
  AnthropicApiError,
  sendMessages,
  extractTextContent,
  toAnthropicHistory,
} from "./api-client.js";

// Config: env-var lookups
export {
  getAnthropicApiKey,
  getDefaultModelId,
  getAnthropicBaseUrl,
  isDev,
} from "./config.js";

// ID generation
export {
  generateMessageId,
  generateConversationId,
  generateCorrelationId,
  generateLaneId,
  generateSessionId,
  generateTerminalId,
  _resetMessageIdCounter,
} from "./id.js";
