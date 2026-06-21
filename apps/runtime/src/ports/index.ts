/**
 * Hexagonal-architecture port interfaces — Phase 3
 *
 * Re-exports all primary and secondary port contracts so the domain
 * core and adapters can depend on a single barrel import.
 *
 * Primary ports (driving side — UI / CLI / test harness calls in):
 *   ILocalBusPort, IWorkspacePort, ISessionPort
 *
 * Secondary ports (driven side — domain calls out to infrastructure):
 *   IAuditPort, IProviderPort
 */

export type { ILocalBusPort, CommandHandler, EventSubscriber } from "./ILocalBusPort.js";
export type { IWorkspacePort, WorkspaceCreateOptions, WorkspaceQuery } from "./IWorkspacePort.js";
export type { IAuditPort, AuditQuery } from "./IAuditPort.js";
export type { ISessionPort, SessionCreateOptions, SessionCheckpoint } from "./ISessionPort.js";
export type {
  IProviderPort,
  ProviderCapabilities,
  InferenceRequest,
  InferenceResponse,
} from "./IProviderPort.js";
