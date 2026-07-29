/**
 * Anthropic API client for the Helios platform.
 *
 * Provides a thin, typed wrapper over the Anthropic Messages API.
 * Both the heliosApp renderer and the colab-renderer use this for
 * direct-to-API chat when the full ElectroBun RPC bridge is not yet wired.
 *
 * wraps: Anthropic Messages REST API v2023-06-01
 * wraps: ky 1.14.3
 */

import ky, { HTTPError } from "ky";
import { getAnthropicApiKey, getAnthropicBaseUrl } from "./config.js";
import type { Message } from "./types.js";

/** Subset of an Anthropic message used for the conversation history. */
export type AnthropicHistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

export type AnthropicTextBlock = {
  type: "text";
  text: string;
};

export type AnthropicContentBlock = AnthropicTextBlock | { type: string };

export type AnthropicMessagesResponse = {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
};

export type AnthropicErrorResponse = {
  type: "error";
  error: {
    type: string;
    message: string;
  };
};

export type SendMessagesOptions = {
  /** Anthropic model ID, e.g. "claude-sonnet-4-20250514". */
  model: string;
  /** Prior conversation messages to include as context. */
  history: AnthropicHistoryEntry[];
  /** Maximum tokens the model may generate in its response. */
  maxTokens?: number;
  /** Anthropic API key — falls back to env lookup when omitted. */
  apiKey?: string;
};

export class AnthropicApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "AnthropicApiError";
  }
}

/**
 * Sends a list of messages to the Anthropic Messages API and returns
 * the full response object.
 *
 * Throws `AnthropicApiError` on non-2xx HTTP responses.
 */
export async function sendMessages(
  opts: SendMessagesOptions,
): Promise<AnthropicMessagesResponse> {
  const apiKey = opts.apiKey ?? getAnthropicApiKey();
  const baseUrl = getAnthropicBaseUrl();

  try {
    return await ky
      .post(`${baseUrl}/v1/messages`, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        json: {
          model: opts.model,
          max_tokens: opts.maxTokens ?? 4096,
          messages: opts.history,
        },
        retry: { limit: 3, methods: ["post"], statusCodes: [429, 500, 502, 503, 504] },
      })
      .json<AnthropicMessagesResponse>();
  } catch (err: unknown) {
    // ky wraps HTTP errors in HTTPError; extract status + body for AnthropicApiError
    if (err instanceof HTTPError) {
      const errorText = await err.response.text();
      throw new AnthropicApiError(
        err.response.status,
        errorText,
        `Anthropic API returned ${err.response.status}: ${errorText}`,
      );
    }
    throw err;
  }
}

/**
 * Extracts the plain text content from an Anthropic Messages response.
 */
export function extractTextContent(response: AnthropicMessagesResponse): string {
  return response.content
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Converts a list of `Message` objects into the minimal history format
 * the Anthropic API accepts (user/assistant role pairs only).
 *
 * Strips system, tool_call, and tool_result messages from the history
 * because the Anthropic Messages API handles them separately.
 */
export function toAnthropicHistory(messages: Message[]): AnthropicHistoryEntry[] {
  return messages
    .filter((m): m is Message & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant",
    )
    .map((m) => ({ role: m.role, content: m.content }));
}
