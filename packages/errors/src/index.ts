/**
 * Common error codes across Helios platform.
 */
export enum ErrorCode {
  // Generic
  INTERNAL_ERROR = "INTERNAL_ERROR",
  INVALID_ARGUMENT = "INVALID_ARGUMENT",
  NOT_FOUND = "NOT_FOUND",
  ALREADY_EXISTS = "ALREADY_EXISTS",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  UNAUTHENTICATED = "UNAUTHENTICATED",
  RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED",
  CANCELLED = "CANCELLED",
  UNAVAILABLE = "UNAVAILABLE",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  TIMEOUT = "TIMEOUT",

  // Protocol/Bus specific
  VALIDATION_ERROR = "VALIDATION_ERROR",
  METHOD_NOT_SUPPORTED = "METHOD_NOT_SUPPORTED",
  MISSING_CORRELATION_ID = "MISSING_CORRELATION_ID",

  // Terminal/Lane/Session
  TERMINAL_NOT_FOUND = "TERMINAL_NOT_FOUND",
  LANE_NOT_FOUND = "LANE_NOT_FOUND",
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  SESSION_NOT_ATTACHED = "SESSION_NOT_ATTACHED",
  TERMINAL_BINDING_INVALID = "TERMINAL_BINDING_INVALID",
}

export interface HeliosErrorDetails {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly fatal?: boolean;
}

export class HeliosAppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly fatal: boolean;

  constructor(code: ErrorCode, message: string, options?: {
    details?: Record<string, unknown>;
    fatal?: boolean;
  }) {
    super(message);
    this.name = "HeliosAppError";
    this.code = code;
    this.details = options?.details;
    this.fatal = options?.fatal ?? false;
  }

  toJSON(): HeliosErrorDetails {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      fatal: this.fatal,
    };
  }
}