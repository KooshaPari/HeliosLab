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

export type { AuditQuery, IAuditPort } from "./IAuditPort.js";
export type {
	CommandHandler,
	EventSubscriber,
	ILocalBusPort,
} from "./ILocalBusPort.js";
export type {
	InferenceRequest,
	InferenceResponse,
	IProviderPort,
	ProviderCapabilities,
} from "./IProviderPort.js";
export type {
	ISessionPort,
	SessionCheckpoint,
	SessionCreateOptions,
} from "./ISessionPort.js";
export type {
	IWorkspacePort,
	WorkspaceCreateOptions,
	WorkspaceQuery,
} from "./IWorkspacePort.js";
