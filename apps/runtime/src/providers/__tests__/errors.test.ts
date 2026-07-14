/**
 * Tests for Normalized Provider Error Taxonomy
 *
 * FR-025-011: Normalized error codes and retryable flags.
 * SC-025-004: All provider errors map to normalized taxonomy.
 */

import { describe, it, expect } from "bun:test";
import {
  NormalizedProviderError,
  normalizeError,
  isRetryable,
  getErrorMessage,
  PROVIDER_ERROR_CODES,
} from "../errors.js";

describe("NormalizedProviderError", () => {
  it("should create error with required fields", () => {
    const error = new NormalizedProviderError("PROVIDER_INIT_FAILED", "Initialization failed");

    expect(error.code).toBe("PROVIDER_INIT_FAILED");
    expect(error.message).toBe("Initialization failed");
    expect(error.providerSource).toBe("internal");
    expect(error.retryable).toBe(false);
  });

  it("should preserve original error", () => {
    const original = new Error("Original error");
    const error = new NormalizedProviderError(
      "PROVIDER_TIMEOUT",
      "Timeout occurred",
      "acp",
      true,
      undefined,
      original
    );

    expect(error.originalError).toBe(original);
  });

  it("should include correlation ID", () => {
    const correlationId = "corr-123";
    const error = new NormalizedProviderError(
      "PROVIDER_EXECUTE_FAILED",
      "Execution failed",
      "mcp",
      true,
      correlationId
    );

    expect(error.correlationId).toBe(correlationId);
  });

  it("should be instanceof Error", () => {
    const error = new NormalizedProviderError("PROVIDER_INIT_FAILED", "Init failed");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(NormalizedProviderError);
  });
});

describe("normalizeError", () => {
  it("should handle null input", () => {
    const error = normalizeError(null);

    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect(error.code).toBe("PROVIDER_UNKNOWN");
    expect(error.message).toContain("null or undefined");
  });

  it("should handle undefined input", () => {
    const error = normalizeError(undefined);

    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect(error.code).toBe("PROVIDER_UNKNOWN");
  });

  it("should handle string errors", () => {
    const error = normalizeError("Something went wrong");

    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect(error.code).toBe("PROVIDER_UNKNOWN");
    expect(error.message).toContain("Something went wrong");
  });

  it("should handle Error objects", () => {
    const originalError = new Error("Test error");
    const error = normalizeError(originalError, "acp");

    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect(error.providerSource).toBe("acp");
    expect(error.originalError).toBe(originalError);
  });

  it("should detect timeout errors", () => {
    const error = normalizeError(new Error("Request timeout"), "acp");

    expect(error.code).toBe("PROVIDER_TIMEOUT");
    expect(error.retryable).toBe(true);
  });

  it("should detect init errors", () => {
    const error = normalizeError(new Error("Initialization failed"), "acp");

    expect(error.code).toBe("PROVIDER_INIT_FAILED");
    expect(error.retryable).toBe(false);
  });

  it("should detect crash errors", () => {
    const error = normalizeError(new Error("Process exited with code 1"), "acp");

    expect(error.code).toBe("PROVIDER_CRASHED");
    expect(error.retryable).toBe(true);
  });

  it("should detect unavailable errors", () => {
    const error = normalizeError(new Error("Provider unavailable"), "mcp");

    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);
  });

  it("should handle custom error objects with code field", () => {
    const customError = new Error("Test error");
    (customError as any).code = "PROVIDER_TIMEOUT";

    const error = normalizeError(customError, "a2a");

    expect(error.code).toBe("PROVIDER_TIMEOUT");
    expect(error.providerSource).toBe("a2a");
  });

  it("should handle plain objects", () => {
    const error = normalizeError({ message: "Plain object error" }, "internal");

    expect(error).toBeInstanceOf(NormalizedProviderError);
    expect(error.code).toBe("PROVIDER_UNKNOWN");
    expect(error.message).toContain("Plain object error");
  });

  it("should preserve correlation ID", () => {
    const correlationId = "corr-123";
    const error = normalizeError(new Error("Test error"), "acp", correlationId);

    expect(error.correlationId).toBe(correlationId);
  });

  it("should default source to internal", () => {
    const error = normalizeError(new Error("Test"));

    expect(error.providerSource).toBe("internal");
  });
});

describe("isRetryable", () => {
  it("should return true for retryable errors", () => {
    const timeoutError = new NormalizedProviderError("PROVIDER_TIMEOUT", "Timeout", "acp", true);
    expect(isRetryable(timeoutError)).toBe(true);

    const crashError = new NormalizedProviderError("PROVIDER_CRASHED", "Crashed", "mcp", true);
    expect(isRetryable(crashError)).toBe(true);

    const unavailableError = new NormalizedProviderError(
      "PROVIDER_UNAVAILABLE",
      "Unavailable",
      "a2a",
      true
    );
    expect(isRetryable(unavailableError)).toBe(true);
  });

  it("should return false for non-retryable errors", () => {
    const initError = new NormalizedProviderError(
      "PROVIDER_INIT_FAILED",
      "Init failed",
      "acp",
      false
    );
    expect(isRetryable(initError)).toBe(false);

    const policyError = new NormalizedProviderError(
      "PROVIDER_POLICY_DENIED",
      "Policy denied",
      "internal",
      false
    );
    expect(isRetryable(policyError)).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("should generate message for error code without details", () => {
    const message = getErrorMessage("PROVIDER_TIMEOUT");

    expect(message).toContain("timeout");
  });

  it("should replace placeholders with details", () => {
    const message = getErrorMessage("PROVIDER_CONCURRENCY_EXCEEDED", {
      limit: 10,
    });

    expect(message).toContain("10");
  });

  it("should handle missing detail values", () => {
    const message = getErrorMessage("PROVIDER_CRASHED", {});

    expect(message).toContain("(unknown)");
  });

  it("should have message for every error code", () => {
    const codes = Object.values(PROVIDER_ERROR_CODES);

    codes.forEach(code => {
      const message = getErrorMessage(code as any);
      expect(message).toBeTruthy();
      expect(message.length).toBeGreaterThan(0);
    });
  });
});

describe("Error Code Retryability", () => {
  it("PROVIDER_INIT_FAILED should not be retryable", () => {
    const error = new NormalizedProviderError("PROVIDER_INIT_FAILED", "Init failed");
    expect(isRetryable(error)).toBe(false);
  });

  it("PROVIDER_TIMEOUT should be retryable", () => {
    const error = new NormalizedProviderError("PROVIDER_TIMEOUT", "Timeout");
    expect(isRetryable(error)).toBe(true);
  });

  it("PROVIDER_CRASHED should be retryable", () => {
    const error = new NormalizedProviderError("PROVIDER_CRASHED", "Crashed");
    expect(isRetryable(error)).toBe(true);
  });

  it("PROVIDER_POLICY_DENIED should not be retryable", () => {
    const error = new NormalizedProviderError("PROVIDER_POLICY_DENIED", "Policy denied");
    expect(isRetryable(error)).toBe(false);
  });

  it("PROVIDER_CONCURRENCY_EXCEEDED should be retryable", () => {
    const error = new NormalizedProviderError(
      "PROVIDER_CONCURRENCY_EXCEEDED",
      "Concurrency exceeded"
    );
    expect(isRetryable(error)).toBe(true);
  });

  it("PROVIDER_UNAVAILABLE should be retryable", () => {
    const error = new NormalizedProviderError("PROVIDER_UNAVAILABLE", "Unavailable");
    expect(isRetryable(error)).toBe(true);
  });

  it("PROVIDER_EXECUTE_FAILED should be retryable", () => {
    const error = new NormalizedProviderError("PROVIDER_EXECUTE_FAILED", "Execute failed");
    expect(isRetryable(error)).toBe(true);
  });

  it("PROVIDER_UNKNOWN should be retryable", () => {
    const error = new NormalizedProviderError("PROVIDER_UNKNOWN", "Unknown error");
    expect(isRetryable(error)).toBe(true);
  });
});

describe("Error Source Tracking", () => {
  it("should track ACP source", () => {
    const error = new NormalizedProviderError("PROVIDER_TIMEOUT", "Timeout", "acp");
    expect(error.providerSource).toBe("acp");
  });

  it("should track MCP source", () => {
    const error = new NormalizedProviderError("PROVIDER_TIMEOUT", "Timeout", "mcp");
    expect(error.providerSource).toBe("mcp");
  });

  it("should track A2A source", () => {
    const error = new NormalizedProviderError("PROVIDER_TIMEOUT", "Timeout", "a2a");
    expect(error.providerSource).toBe("a2a");
  });

  it("should track internal source", () => {
    const error = new NormalizedProviderError("PROVIDER_TIMEOUT", "Timeout", "internal");
    expect(error.providerSource).toBe("internal");
  });
});

describe("Error Traceability", () => {
  it("should preserve original error chain", () => {
    const original = new Error("Original error");
    const normalized = normalizeError(original, "acp", "corr-123");

    expect(normalized.originalError).toBe(original);
    expect(normalized.correlationId).toBe("corr-123");
  });

  it("should enable error investigation via originalError", () => {
    const original = new Error("Database connection failed");
    (original as any).code = "ECONNREFUSED";

    const normalized = normalizeError(original, "acp");

    // Developer can still access original error for debugging
    expect(normalized.originalError?.message).toBe("Database connection failed");
  });
});
