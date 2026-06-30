/**
 * Method registry for the Helios local bus.
 *
 * Provides single-handler binding per method name with strict validation.
 */

import type { CommandEnvelope, ResponseEnvelope } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A method handler receives a command and returns a response (sync or async). */
export type MethodHandler = (
  command: CommandEnvelope
) => ResponseEnvelope | Promise<ResponseEnvelope>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Method names must be non-empty, alphanumeric with dots. */
const METHOD_NAME_RE = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/;

function assertValidMethodName(method: string): void {
  if (!METHOD_NAME_RE.test(method)) {
    throw new Error(
      `Invalid method name "${method}": must be non-empty, alphanumeric segments separated by dots`
    );
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Canonical list of known method names for validation. */
export const METHODS: readonly string[] = [
  "runtime.workspace.create",
  "runtime.workspace.open",
  "runtime.project.clone",
  "runtime.project.init",
  "runtime.session.create",
  "runtime.session.attach",
  "runtime.session.terminate",
  "runtime.terminal.spawn",
  "runtime.terminal.resize",
  "runtime.terminal.input",
  "runtime.renderer.switch",
  "runtime.renderer.capabilities",
  "runtime.agent.run",
  "runtime.agent.cancel",
  "runtime.approval.request.resolve",
  "runtime.share.upterm.start",
  "runtime.share.upterm.stop",
  "runtime.share.tmate.start",
  "runtime.share.tmate.stop",
  "runtime.zmx.checkpoint",
  "runtime.zmx.restore",
  "runtime.lane.create",
  "runtime.lane.attach",
  "runtime.lane.cleanup",
  "runtime.boundary.local.dispatch",
  "runtime.boundary.tool.dispatch",
  "runtime.boundary.a2a.dispatch",
] as const;

export class MethodRegistry {
  private readonly handlers = new Map<string, MethodHandler>();

  /** Register a handler for a method. Throws if already registered. */
  register(method: string, handler: MethodHandler): void {
    assertValidMethodName(method);
    if (this.handlers.has(method)) {
      throw new Error(`Method "${method}" is already registered`);
    }
    this.handlers.set(method, handler);
  }

  /** Unregister a method. Returns true if it was registered. */
  unregister(method: string): boolean {
    return this.handlers.delete(method);
  }

  /** Look up a handler by method name. */
  resolve(method: string): MethodHandler | undefined {
    return this.handlers.get(method);
  }

  /** List all registered method names. */
  methods(): string[] {
    return [...this.handlers.keys()];
  }

  /** Remove all registrations. */
  clear(): void {
    this.handlers.clear();
  }
}
