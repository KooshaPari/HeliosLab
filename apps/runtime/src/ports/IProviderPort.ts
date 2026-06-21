/**
 * Secondary port: AI inference provider
 *
 * Defines the hexagonal-architecture secondary (driven) port for
 * pluggable AI inference back-ends (Anthropic, local models, …).
 *
 * Referenced FRs map to specs/025-provider-adapter-interface-and-lifecycle.
 */

import type { AnthropicHistoryEntry } from "../../packages/runtime-core/src/api-client.js";

export interface ProviderCapabilities {
  readonly maxTokens: number;
  readonly supportsStreaming: boolean;
  readonly supportedRoles: ReadonlyArray<"user" | "assistant" | "system">;
}

export interface InferenceRequest {
  readonly model: string;
  readonly history: AnthropicHistoryEntry[];
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
}

export interface InferenceResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly stopReason: string | null;
}

/**
 * IProviderPort — secondary port for AI inference.
 *
 * @see packages/runtime-core/src/api-client.ts — Anthropic adapter
 */
export interface IProviderPort {
  /** Unique provider identifier (e.g. "anthropic", "ollama"). */
  readonly providerId: string;

  /** Return static capability metadata without a network call. */
  capabilities(): ProviderCapabilities;

  /** Send a non-streaming inference request; returns the full reply. */
  infer(request: InferenceRequest): Promise<InferenceResponse>;

  /** Health-check the provider; must not throw — returns ok/error result. */
  healthCheck(): Promise<{ ok: boolean; reason?: string }>;
}
