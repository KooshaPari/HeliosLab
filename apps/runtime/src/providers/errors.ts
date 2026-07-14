/**
 * Normalized Provider Error Taxonomy
 *
 * Maps all provider error types (ACP, MCP, A2A, internal) to a common
 * error code system with retryable flags.
 *
 * FR-025-011: Normalized error taxonomy mapping provider errors.
 * SC-025-004: All provider errors map to normalized taxonomy.
 */

/**
 * Error codes for provider execution.
 * Each code represents a specific failure mode with a defined retryable status.
 */
export const PROVIDER_ERROR_CODES = {
  /** Provider initialization failed (config validation, process spawn, etc.) */
  PROVIDER_INIT_FAILED: "PROVIDER_INIT_FAILED",
  /** Provider init exceeded 5 second timeout */
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  /** Provider process crashed unexpectedly */
  PROVIDER_CRASHED: "PROVIDER_CRASHED",
  /** Policy engine rejected provider action */
  PROVIDER_POLICY_DENIED: "PROVIDER_POLICY_DENIED",
  /** Concurrent execute calls exceeded configured limit */
  PROVIDER_CONCURRENCY_EXCEEDED: "PROVIDER_CONCURRENCY_EXCEEDED",
  /** Provider is unavailable (not initialized, degraded, crashed) */
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  /** Provider execute call failed */
  PROVIDER_EXECUTE_FAILED: "PROVIDER_EXECUTE_FAILED",
  /** Unknown error code (fallback only for unmapped errors) */
  PROVIDER_UNKNOWN: "PROVIDER_UNKNOWN",
} as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[keyof typeof PROVIDER_ERROR_CODES];

/**
 * Retryability status for each error code.
 * Determines if an operation should be retried on failure.
 */
const ERROR_RETRYABLE_STATUS: Record<ProviderErrorCode, boolean> = {
  PROVIDER_INIT_FAILED: false, // Init failures are not retried; provider must be reconfigured
  PROVIDER_TIMEOUT: true, // Timeout may be transient; allow retry with backoff
  PROVIDER_CRASHED: true, // Crash may be transient; allow retry after restart
  PROVIDER_POLICY_DENIED: false, // Policy denial is not transient; requires policy change
  PROVIDER_CONCURRENCY_EXCEEDED: true, // Concurrency may be transient; allow retry with backoff
  PROVIDER_UNAVAILABLE: true, // Unavailability may be transient; allow retry after health check
  PROVIDER_EXECUTE_FAILED: true, // Execute failure may be transient; allow retry
  PROVIDER_UNKNOWN: true, // Unknown errors treated as transient
};

/**
 * Human-readable message templates for each error code.
 */
const ERROR_MESSAGE_TEMPLATES: Record<ProviderErrorCode, string> = {
  PROVIDER_INIT_FAILED: "Provider initialization failed: {details}",
  PROVIDER_TIMEOUT: "Provider initialization exceeded 5 second timeout",
  PROVIDER_CRASHED: "Provider process crashed with exit code {exitCode}",
  PROVIDER_POLICY_DENIED: "Provider action denied by policy engine: {policy}",
  PROVIDER_CONCURRENCY_EXCEEDED: "Provider concurrency limit ({limit}) exceeded",
  PROVIDER_UNAVAILABLE: "Provider is unavailable: {reason}",
  PROVIDER_EXECUTE_FAILED: "Provider execute call failed: {details}",
  PROVIDER_UNKNOWN: "Unknown provider error: {details}",
};

/**
 * Normalized provider error class.
 * Wraps all provider errors (ACP, MCP, A2A, internal) into a common structure.
 *
 * FR-025-011: Common error envelope with code, message, provider source, retryable flag.
 */
export class NormalizedProviderError extends Error {
  /**
   * Unique error code identifying the failure mode.
   */
  readonly code: ProviderErrorCode;

  /**
   * Source of the error.
   * - "acp": ACP provider (Claude)
   * - "mcp": MCP provider (tools)
   * - "a2a": A2A provider (external agents)
   * - "internal": Runtime or adapter-level error
   */
  readonly providerSource: "acp" | "mcp" | "a2a" | "internal";

  /**
   * Whether this error is retryable.
   * If true, the operation may be retried; if false, it requires intervention.
   */
  readonly retryable: boolean;

  /**
   * Optional correlation ID for bus message tracing.
   */
  readonly correlationId?: string;

  /**
   * Original error that triggered this normalization.
   * Preserved for debugging and detailed error analysis.
   */
  readonly originalError?: Error;

  constructor(
    code: ProviderErrorCode,
    message: string,
    providerSource: "acp" | "mcp" | "a2a" | "internal" = "internal",
    retryable = ERROR_RETRYABLE_STATUS[code],
    correlationId?: string,
    originalError?: Error
  ) {
    super(message);
    this.name = "NormalizedProviderError";
    this.code = code;
    this.providerSource = providerSource;
    this.retryable = retryable;
    this.correlationId = correlationId;
    this.originalError = originalError;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, NormalizedProviderError.prototype);
  }
}

/**
 * Normalize any error from provider execution into a NormalizedProviderError.
 *
 * Handles:
 * - null/undefined inputs
 * - String errors
 * - Error objects
 * - Custom error objects with code properties
 *
 * @param error The error to normalize
 * @param source Provider source (acp, mcp, a2a, internal)
 * @param correlationId Optional correlation ID for tracing
 * @returns Normalized error with code, message, and retryable flag
 */
export function normalizeError(
  error: unknown,
  source: "acp" | "mcp" | "a2a" | "internal" = "internal",
  correlationId?: string
): NormalizedProviderError {
  // Handle null/undefined
  if (error === null || error === undefined) {
    return new NormalizedProviderError(
      "PROVIDER_UNKNOWN",
      "Unknown error: received null or undefined",
      source,
      ERROR_RETRYABLE_STATUS["PROVIDER_UNKNOWN"],
      correlationId
    );
  }

  // Handle string errors
  if (typeof error === "string") {
    return new NormalizedProviderError(
      "PROVIDER_UNKNOWN",
      `Unknown error: ${error}`,
      source,
      ERROR_RETRYABLE_STATUS["PROVIDER_UNKNOWN"],
      correlationId
    );
  }

  // Handle Error objects
  if (error instanceof Error) {
    // Check for known error codes in custom error objects
    if ("code" in error && typeof (error as any).code === "string") {
      const code = (error as any).code as ProviderErrorCode;
      if (code in ERROR_RETRYABLE_STATUS) {
        return new NormalizedProviderError(
          code,
          error.message || ERROR_MESSAGE_TEMPLATES[code],
          source,
          ERROR_RETRYABLE_STATUS[code],
          correlationId,
          error
        );
      }
    }

    // Check for specific error patterns
    if (error.message.includes("timeout") || error.message.includes("TIMEOUT")) {
      return new NormalizedProviderError(
        "PROVIDER_TIMEOUT",
        error.message,
        source,
        ERROR_RETRYABLE_STATUS["PROVIDER_TIMEOUT"],
        correlationId,
        error
      );
    }

    if (error.message.includes("init") || error.message.includes("initialization")) {
      return new NormalizedProviderError(
        "PROVIDER_INIT_FAILED",
        error.message,
        source,
        ERROR_RETRYABLE_STATUS["PROVIDER_INIT_FAILED"],
        correlationId,
        error
      );
    }

    if (error.message.includes("crash") || error.message.includes("exit")) {
      return new NormalizedProviderError(
        "PROVIDER_CRASHED",
        error.message,
        source,
        ERROR_RETRYABLE_STATUS["PROVIDER_CRASHED"],
        correlationId,
        error
      );
    }

    if (error.message.includes("unavailable")) {
      return new NormalizedProviderError(
        "PROVIDER_UNAVAILABLE",
        error.message,
        source,
        ERROR_RETRYABLE_STATUS["PROVIDER_UNAVAILABLE"],
        correlationId,
        error
      );
    }

    // Fallback to generic execute failed
    return new NormalizedProviderError(
      "PROVIDER_EXECUTE_FAILED",
      error.message || "Provider execution failed",
      source,
      ERROR_RETRYABLE_STATUS["PROVIDER_EXECUTE_FAILED"],
      correlationId,
      error
    );
  }

  // Handle plain objects with error-like properties
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const message =
      (typeof obj.message === "string" ? obj.message : "") ||
      (typeof obj.error === "string" ? obj.error : "") ||
      "Unknown error from plain object";

    return new NormalizedProviderError(
      "PROVIDER_UNKNOWN",
      message,
      source,
      ERROR_RETRYABLE_STATUS["PROVIDER_UNKNOWN"],
      correlationId
    );
  }

  // Fallback for any other type
  return new NormalizedProviderError(
    "PROVIDER_UNKNOWN",
    `Unknown error of type ${typeof error}`,
    source,
    ERROR_RETRYABLE_STATUS["PROVIDER_UNKNOWN"],
    correlationId
  );
}

/**
 * Check if an error is retryable.
 *
 * @param error The error to check
 * @returns true if the error is retryable, false otherwise
 */
export function isRetryable(error: NormalizedProviderError): boolean {
  return error.retryable;
}

/**
 * Generate human-readable message for an error code.
 *
 * @param code The error code
 * @param details Additional details to include in the message
 * @returns Formatted message string
 */
export function getErrorMessage(
  code: ProviderErrorCode,
  details?: Record<string, unknown>
): string {
  let message = ERROR_MESSAGE_TEMPLATES[code];

  if (details) {
    // Replace {key} placeholders with values from details
    Object.entries(details).forEach(([key, value]) => {
      message = message.replace(`{${key}}`, String(value));
    });
  }

  // Remove any remaining unreplaced placeholders
  message = message.replace(/\{\w+\}/g, "(unknown)");

  return message;
}
