/**
 * T013 - Orphan reconciliation.
 *
 * Compares live zellij sessions against the binding registry to detect
 * and clean up orphaned sessions and stale registry entries.
 */

import type { ZellijCli } from "./cli.js";
import type { MuxRegistry } from "./registry.js";

/** Result of a reconciliation pass. */
export interface ReconciliationResult {
  /** Live zellij sessions that had no registry binding (terminated). */
  orphanedSessionsTerminated: string[];
  /** Registry entries whose zellij sessions no longer exist (cleaned). */
  staleBindingsCleaned: string[];
  /** Total live sessions inspected. */
  liveSessionCount: number;
  /** Total registry bindings inspected. */
  registryBindingCount: number;
}

/**
 * Run a single reconciliation pass.
 *
 * 1. Query live zellij sessions via `zellij list-sessions`.
 * 2. For each live session with the `helios-lane-` prefix that has
 *    no matching registry binding, terminate it.
 * 3. For each registry binding whose session is no longer live,
 *    remove the binding.
 */
export async function reconcile(
  cli: ZellijCli,
  registry: MuxRegistry
): Promise<ReconciliationResult> {
  const liveSessions = await cli.listSessions();
  const liveNames = new Set(liveSessions.map(s => s.name));
  const bindings = registry.list();

  const result: ReconciliationResult = {
    orphanedSessionsTerminated: [],
    staleBindingsCleaned: [],
    liveSessionCount: liveSessions.length,
    registryBindingCount: bindings.length,
  };

  // 1. Terminate live sessions that are unbound (orphans)
  for (const session of liveSessions) {
    if (!session.name.startsWith("helios-lane-")) continue;
    const binding = registry.getBySession(session.name);
    if (!binding) {
      // Orphan - terminate it
      const killResult = await cli.run(["kill-session", session.name]);
      if (
        killResult.exitCode === 0 ||
        killResult.stderr.includes("not found") ||
        killResult.stderr.includes("No session")
      ) {
        result.orphanedSessionsTerminated.push(session.name);
      }
    }
  }

  // 2. Clean up stale registry entries (binding exists but session is dead)
  for (const binding of bindings) {
    if (!liveNames.has(binding.sessionName)) {
      registry.unbind(binding.sessionName);
      result.staleBindingsCleaned.push(binding.sessionName);
    }
  }

  return result;
}
