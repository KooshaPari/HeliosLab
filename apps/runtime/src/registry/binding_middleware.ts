/**
 * Binding Validation Middleware
 *
 * Intercepts terminal operations and validates bindings before execution.
 * Rejects operations on terminals with invalid or stale bindings.
 */

import type { RegistryQueryInterface, TerminalBinding } from "./binding_triple.js";


import type { TerminalRegistry } from "./terminal_registry.js";

export interface ValidationError {
  code: string;
  message: string;
  fatal: boolean;
}

export interface MiddlewareValidationResult {
  valid: boolean;
  error?: ValidationError;
  binding?: TerminalBinding;
}

/**
 * Middleware for pre-operation binding validation.
 *
 * Validates:
 * - Terminal exists in registry
 * - Terminal binding state is 'bound' or 'rebound'
 * - Binding triple is still valid (re-validates against current state)
 */
export class BindingMiddleware {
  private registryQueryInterface: RegistryQueryInterface;

  constructor(private registry: TerminalRegistry) {
    this.registryQueryInterface = registry;
  }

  /**
   * Validate terminal binding before an operation.
   *
   * Checks:
   * 1. Terminal exists in registry
   * 2. Binding state is valid (bound or rebound)
   * 3. Binding triple is still current (re-validates against registries)
   *
   * If re-validation fails, updates binding state to 'validation_failed'.
   */
  validateBeforeOperation(terminalId: string, _operation?: string): MiddlewareValidationResult {
    // Check terminal exists
    const _binding = this.registry.get(terminalId);
    if (!binding) {
      return {
        valid: false,
        error: {
          code: "TERMINAL_NOT_FOUND",
          message: `Terminal ${terminalId} not found in registry`,
          fatal: true,
        },
      };
    }

    // Check binding state
    if (binding.state !== BindingState.bound && binding.state !== BindingState.rebound) {
      return {
        valid: false,
        error: {
          code: "INVALID_BINDING_STATE",
          message: `Terminal binding is in ${binding.state} state, expected 'bound' or 'rebound'`,
          fatal:
            binding.state === BindingState.validation_failed ||
            binding.state === BindingState.unbound,
        },
        binding,
      };
    }

    // Check binding staleness: verify the binding's context IDs still exist in registry indexes
    const boundWorkspace = this.registry.getByWorkspace(binding.binding.workspaceId);
    const boundLane = this.registry.getByLane(binding.binding.laneId);
    const boundSession = this.registry.getBySession(binding.binding.sessionId);
    const isStale =
      !boundWorkspace.some(b => b.terminalId === terminalId) ||
      !boundLane.some(b => b.terminalId === terminalId) ||
      !boundSession.some(b => b.terminalId === terminalId);

    if (isStale) {
      // Mark binding as validation failed
      binding.state = BindingState.validation_failed;
      binding.updatedAt = Date.now();

      return {
        valid: false,
        error: {
          code: "STALE_BINDING",
          message: `Terminal binding is stale: binding context no longer matches registry indexes`,
          fatal: true,
        },
        binding,
      };
    }

    return {
      valid: true,
      binding,
    };
  }

  /**
   * Middleware wrapper that validates before executing a handler.
   *
   * @param terminalId The terminal to validate
   * @param handler The operation handler to execute
   * @param operation Optional operation name for logging
   * @returns Result of handler or validation error
   */
  async wrapOperation<T>(
    terminalId: string,
    handler: (binding: TerminalBinding) => Promise<T>,
    operation?: string
  ): Promise<T> {
    const validation = this.validateBeforeOperation(terminalId, operation);

    if (!validation.valid) {
      const error = validation.error || {
        code: "VALIDATION_FAILED",
        message: "Unknown validation error",
        fatal: true,
      };
      throw new Error(`${error.code}: ${error.message}`);
    }

    return handler(validation.binding!);
  }

  /**
   * Synchronous variant of wrapOperation (for single-threaded Bun context).
   */
  wrapOperationSync<T>(
    terminalId: string,
    handler: (binding: TerminalBinding) => T,
    operation?: string
  ): T {
    const validation = this.validateBeforeOperation(terminalId, operation);

    if (!validation.valid) {
      const error = validation.error || {
        code: "VALIDATION_FAILED",
        message: "Unknown validation error",
        fatal: true,
      };
      throw new Error(`${error.code}: ${error.message}`);
    }

    return handler(validation.binding!);
  }
}

/**
 * Creates a middleware-wrapped handler for terminal operations.
 *
 * Usage:
 *   const wrapped = createMiddlewareHandler(middleware, terminalId, originalHandler);
 *   await wrapped();
 */
export function createMiddlewareHandler<T>(
  middleware: BindingMiddleware,
  terminalId: string,
  handler: (binding: TerminalBinding) => Promise<T>,
  operation?: string
): () => Promise<T> {
  return () => middleware.wrapOperation(terminalId, handler, operation);
}

/**
 * Synchronous variant of createMiddlewareHandler.
 */
export function createMiddlewareHandlerSync<T>(
  middleware: BindingMiddleware,
  terminalId: string,
  handler: (binding: TerminalBinding) => T,
  operation?: string
): () => T {
  return () => middleware.wrapOperationSync(terminalId, handler, operation);
}
