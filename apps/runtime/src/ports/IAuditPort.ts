/**
 * Secondary port: Append-only audit log
 *
 * Defines the hexagonal-architecture secondary port for the audit
 * ledger.  Driven-side adapters (SQLiteAuditStore, in-memory, …)
 * implement this interface.
 *
 * FR-005: The runtime MUST persist every bus event to a durable,
 *         append-only audit store accessible for replay and export.
 */

import type { RuntimeAuditRecord, RuntimeAuditBundle } from "../runtime/types.js";

export interface AuditQuery {
  readonly type?: RuntimeAuditRecord["type"];
  readonly method?: string;
  readonly topic?: string;
  readonly since?: string;  // ISO-8601 lower bound
  readonly limit?: number;
}

/**
 * IAuditPort — secondary port for audit event persistence.
 *
 * @see apps/runtime/src/audit/ledger.ts — default adapter
 */
export interface IAuditPort {
  /** Append a single audit record. Must never throw on storage errors — log + swallow. */
  append(record: RuntimeAuditRecord): Promise<void>;

  /** Query records matching the supplied filter. */
  query(filter: AuditQuery): Promise<readonly RuntimeAuditRecord[]>;

  /** Export a time-bounded bundle for compliance/replay. */
  export(since: string, until: string): Promise<RuntimeAuditBundle>;

  /** Apply retention policy — delete records older than the given ISO date. */
  purge(before: string): Promise<number>;
}
