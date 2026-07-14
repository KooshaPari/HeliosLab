/**
 * Share Session Entity and On-Demand Worker Lifecycle Management
 *
 * Manages terminal sharing sessions with on-demand worker process spawning.
 * FR-026-001: Share session entity with worker lifecycle.
 * FR-026-003: Policy gate integration.
 */

import type { LocalBus } from "../../protocol/bus.js";

/**
 * Share session state.
 */
export type ShareSessionState = "pending" | "active" | "expired" | "revoked" | "failed";

/**
 * Share backend type.
 */
export type ShareBackend = "upterm" | "tmate";

/**
 * Share session entity.
 */
export interface ShareSession {
  id: string;
  terminalId: string;
  backend: ShareBackend;
  shareLink: string | null;
  state: ShareSessionState;
  ttlMs: number;
  createdAt: Date;
  expiresAt: Date | null;
  workerPid: number | null;
  correlationId: string;
  message?: string;
}

/**
 * Share worker configuration.
 */
export interface ShareWorkerConfig {
  backend: ShareBackend;
  terminalId: string;
  correlationId: string;
  ttlMs: number;
}

/**
 * Share worker result.
 */
export interface ShareWorkerResult {
  pid: number;
  link: string;
}

/**
 * Share Worker Process Manager
 *
 * Spawns and manages the lifecycle of share worker processes.
 */
export class ShareWorker {
  private process: any = null;
  private hearbeat: NodeJS.Timeout | null = null;

  /**
   * Spawn a share worker process.
   *
   * @param config Share worker configuration
   * @returns Worker PID and generated share link
   * @throws Error if spawn fails
   */
  async spawn(config: ShareWorkerConfig): Promise<ShareWorkerResult> {
    try {
      // Mock implementation: simulate worker spawn and link generation
      const link = this.generateMockLink(config.backend, config.terminalId);
      const pid = Math.floor(Math.random() * 100000) + 1000;

      // Set up heartbeat monitoring (mock)
      this.hearbeat = setInterval(() => {
        // Heartbeat check would happen here
        // In mock, always healthy
      }, 5000);

      return { pid, link };
    } catch (error) {
      throw new Error(`Failed to spawn share worker: ${String(error)}`);
    }
  }

  /**
   * Kill the share worker process.
   */
  async kill(): Promise<void> {
    if (this.hearbeat) {
      clearInterval(this.hearbeat);
      this.hearbeat = null;
    }
    // In real implementation, would send SIGTERM/SIGKILL
    this.process = null;
  }

  /**
   * Generate mock share link.
   */
  private generateMockLink(backend: ShareBackend, terminalId: string): string {
    const timestamp = Date.now();
    const baseUrl = backend === "upterm" ? "https://upterm.io" : "https://tmate.io";
    return `${baseUrl}/${terminalId}-${timestamp}`;
  }
}

/**
 * Policy Gate interface.
 */
export interface PolicyGate {
  evaluate(
    action: string,
    context: Record<string, unknown>
  ): Promise<{ allowed: boolean; reason?: string }>;
}

/**
 * Default pass-through policy gate.
 */
class DefaultPolicyGate implements PolicyGate {
  async evaluate(): Promise<{ allowed: boolean }> {
    return { allowed: true };
  }
}

/**
 * Share Session Manager
 *
 * Manages the lifecycle of share sessions including creation, termination,
 * and policy gating.
 *
 * FR-026-001: Share session lifecycle management.
 * FR-026-003: Policy gate pre-share hook.
 */
export class ShareSessionManager {
  private sessions = new Map<string, ShareSession>();
  private sessionsByTerminal = new Map<string, Set<string>>();
  private bus: LocalBus | null = null;
  private policyGate: PolicyGate;

  constructor(bus?: LocalBus, policyGate?: PolicyGate) {
    this.bus = bus || null;
    this.policyGate = policyGate || new DefaultPolicyGate();
  }

  /**
   * Create a new share session.
   *
   * FR-026-001: Session creation with worker lifecycle.
   * FR-026-003: Policy gate check before worker start.
   *
   * @param terminalId Terminal ID to share
   * @param backend Share backend
   * @param ttlMs Time-to-live in milliseconds
   * @param correlationId Correlation ID
   * @returns Created share session
   * @throws Error if creation fails
   */
  async create(
    terminalId: string,
    backend: ShareBackend,
    ttlMs: number,
    correlationId: string
  ): Promise<ShareSession> {
    // Check policy gate
    const policyDecision = await this.policyGate.evaluate("share.session.create", {
      terminalId,
      backend,
      correlationId,
    });

    if (!policyDecision.allowed) {
      const session: ShareSession = {
        id: `share-${Date.now()}`,
        terminalId,
        backend,
        shareLink: null,
        state: "failed",
        ttlMs,
        createdAt: new Date(),
        expiresAt: null,
        workerPid: null,
        correlationId,
        message: `Policy denied: ${policyDecision.reason || "Access denied"}`,
      };

      await this.publishEvent("share.session.failed", {
        sessionId: session.id,
        reason: session.message,
      });

      throw new Error(session.message);
    }

    // Create session in pending state
    const session: ShareSession = {
      id: `share-${Date.now()}`,
      terminalId,
      backend,
      shareLink: null,
      state: "pending",
      ttlMs,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
      workerPid: null,
      correlationId,
    };

    this.sessions.set(session.id, session);
    if (!this.sessionsByTerminal.has(terminalId)) {
      this.sessionsByTerminal.set(terminalId, new Set());
    }
    this.sessionsByTerminal.get(terminalId)!.add(session.id);

    await this.publishEvent("share.session.created", {
      sessionId: session.id,
      terminalId,
      backend,
    });

    try {
      // Spawn worker
      const worker = new ShareWorker();
      const workerResult = await worker.spawn({
        backend,
        terminalId,
        correlationId,
        ttlMs,
      });

      // Update session with worker details
      session.workerPid = workerResult.pid;
      session.shareLink = workerResult.link;
      session.state = "active";

      await this.publishEvent("share.session.active", {
        sessionId: session.id,
        shareLink: session.shareLink,
        workerPid: session.workerPid,
      });

      return session;
    } catch (error) {
      session.state = "failed";
      session.message = String(error);

      await this.publishEvent("share.session.failed", {
        sessionId: session.id,
        reason: session.message,
      });

      throw error;
    }
  }

  /**
   * Terminate a share session.
   *
   * @param sessionId Session ID to terminate
   * @throws Error if session not found
   */
  async terminate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    try {
      // Kill worker if running
      if (session.workerPid) {
        const worker = new ShareWorker();
        await worker.kill();
      }

      // Update state
      session.state = "revoked";

      await this.publishEvent("share.session.terminated", {
        sessionId,
      });

      // Remove from tracking
      this.sessions.delete(sessionId);
      const terminalSessions = this.sessionsByTerminal.get(session.terminalId);
      if (terminalSessions) {
        terminalSessions.delete(sessionId);
      }
    } catch (error) {
      throw new Error(`Failed to terminate session: ${String(error)}`);
    }
  }

  /**
   * Get a share session by ID.
   *
   * @param sessionId Session ID
   * @returns Session or undefined if not found
   */
  get(sessionId: string): ShareSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all share sessions for a terminal.
   *
   * @param terminalId Terminal ID
   * @returns Array of sessions
   */
  listByTerminal(terminalId: string): ShareSession[] {
    const sessionIds = this.sessionsByTerminal.get(terminalId) || new Set();
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((s): s is ShareSession => s !== undefined);
  }

  /**
   * Publish event on the protocol bus.
   *
   * @param topic Event topic
   * @param payload Event payload
   */
  private async publishEvent(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.bus) {
      return;
    }

    try {
      await this.bus.publish({
        id: `share-${Date.now()}-${Math.random()}`,
        type: "event",
        ts: new Date().toISOString(),
        topic,
        payload,
      });
    } catch (error) {
      console.warn(`Failed to publish share event ${topic}:`, error);
    }
  }
}
