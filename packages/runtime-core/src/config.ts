/**
 * Environment config helpers for the Helios platform.
 *
 * Centralises all env-var lookups so both heliosApp renderer and
 * colab-renderer read from the same locations in the same priority order.
 *
 * wraps: nothing — pure first-party extraction
 */

/**
 * Returns the Anthropic API key from the environment, checking multiple
 * variable names in priority order:
 *   1. ANTHROPIC_API_KEY
 *   2. HELIOS_ACP_API_KEY
 *
 * Returns an empty string when neither is set.
 */
export function getAnthropicApiKey(): string {
  if (typeof process !== "undefined") {
    return (
      process.env?.ANTHROPIC_API_KEY ??
      process.env?.HELIOS_ACP_API_KEY ??
      ""
    );
  }
  return "";
}

/**
 * Returns the default model ID to use for chat completions.
 * Can be overridden by the HELIOS_DEFAULT_MODEL env var.
 */
export function getDefaultModelId(): string {
  if (typeof process !== "undefined") {
    return process.env?.HELIOS_DEFAULT_MODEL ?? "claude-sonnet-4-20250514";
  }
  return "claude-sonnet-4-20250514";
}

/**
 * Returns the Anthropic API base URL.
 * Can be overridden by ANTHROPIC_BASE_URL for proxying scenarios.
 */
export function getAnthropicBaseUrl(): string {
  if (typeof process !== "undefined") {
    return (
      process.env?.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"
    );
  }
  return "https://api.anthropic.com";
}

/**
 * Returns true when the environment is a development build.
 */
export function isDev(): boolean {
  if (typeof process !== "undefined") {
    return process.env?.NODE_ENV === "development";
  }
  return false;
}
