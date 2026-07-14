import { Database } from "bun:sqlite";
import type { AuditEvent } from "./event";
import type { AuditFilter } from "./ring-buffer";
import fs from "fs";


/**
 * SQLite-backed persistent storage for audit events.
 * Supports 30+ days of retention with indexed queries.
 */
export class SQLiteAuditStore {
  private db: Database;
  private readonly dbPath: string;
  private schemaVersion = 1;

  /**
   * Create or open an SQLite audit store.
   *
   * @param dbPath - Path to SQLite database file
   */
  constructor(dbPath: string = ":memory:") {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);

    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA page_size = 4096");
    this.db.exec("PRAGMA temp_store = MEMORY");
    this.db.exec("PRAGMA auto_vacuum = INCREMENTAL");

    // Initialize schema
    this.initializeSchema();
  }

  /**
   * Persist a batch of audit events to the database.
   * Batch inserts for efficiency.
   *
   * @param events - Array of events to persist
   */
  persist(events: AuditEvent[]): void {
    if (events.length === 0) {
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO audit_events (
        id, event_type, actor, action, target, result,
        timestamp, workspace_id, lane_id, session_id,
        correlation_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    const transaction = this.db.transaction((eventBatch: AuditEvent[]) => {
      for (const event of eventBatch) {
        stmt.run(
          event.id,
          event.eventType,
          event.actor,
          event.action,
          event.target,
          event.result,
          event.timestamp,
          event.workspaceId,
          event.laneId || null,
          event.sessionId || null,
          event.correlationId,
          JSON.stringify(event.metadata)
        );
      }
    });

    transaction(events);
  }

  /**
   * Query events from the database with filtering and pagination.
   *
   * @param filter - Filter criteria
   * @param options - Query options (limit, offset)
   * @returns Array of matching events
   */
  query(filter: AuditFilter, options: { limit?: number; offset?: number } = {}): AuditEvent[] {
    const { limit = 100, offset = 0 } = options;

    let query = "SELECT * FROM audit_events WHERE 1=1";
    const params: any[] = [];

    if (filter.workspaceId) {
      query += " AND workspace_id = ?";
      params.push(filter.workspaceId);
    }

    if (filter.laneId) {
      query += " AND lane_id = ?";
      params.push(filter.laneId);
    }

    if (filter.sessionId) {
      query += " AND session_id = ?";
      params.push(filter.sessionId);
    }

    if (filter.actor) {
      query += " AND actor = ?";
      params.push(filter.actor);
    }

    if (filter.eventType) {
      query += " AND event_type = ?";
      params.push(filter.eventType);
    }

    if (filter.startTime) {
      query += " AND timestamp >= ?";
      params.push(filter.startTime.toISOString());
    }

    if (filter.endTime) {
      query += " AND timestamp <= ?";
      params.push(filter.endTime.toISOString());
    }

    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.rowToEvent(row));
  }

  /**
   * Get all events with a given correlation ID (follow chains).
   *
   * @param correlationId - Correlation ID
   * @returns Array of events with matching correlation ID
   */
  getByCorrelationChain(correlationId: string): AuditEvent[] {
    const stmt = this.db.prepare(
      "SELECT * FROM audit_events WHERE correlation_id = ? ORDER BY timestamp ASC, id ASC"
    );
    const rows = stmt.all(correlationId) as any[];

    return rows.map(row => this.rowToEvent(row));
  }

  /**
   * Count events matching the filter.
   *
   * @param filter - Optional filter criteria
   * @returns Number of matching events
   */
  count(filter?: AuditFilter): number {
    const { filter: actualFilter = {} } = { filter: filter || {} };

    let query = "SELECT COUNT(*) as count FROM audit_events WHERE 1=1";
    const params: any[] = [];

    if (actualFilter.workspaceId) {
      query += " AND workspace_id = ?";
      params.push(actualFilter.workspaceId);
    }

    if (actualFilter.laneId) {
      query += " AND lane_id = ?";
      params.push(actualFilter.laneId);
    }

    if (actualFilter.sessionId) {
      query += " AND session_id = ?";
      params.push(actualFilter.sessionId);
    }

    if (actualFilter.actor) {
      query += " AND actor = ?";
      params.push(actualFilter.actor);
    }

    if (actualFilter.eventType) {
      query += " AND event_type = ?";
      params.push(actualFilter.eventType);
    }

    if (actualFilter.startTime) {
      query += " AND timestamp >= ?";
      params.push(actualFilter.startTime.toISOString());
    }

    if (actualFilter.endTime) {
      query += " AND timestamp <= ?";
      params.push(actualFilter.endTime.toISOString());
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as any;

    return result?.count || 0;
  }

  /**
   * Get the size of the SQLite database file.
   *
   * @returns Size in bytes
   */
  getStorageSize(): number {
    try {
      if (this.dbPath === ":memory:") {
        return 0;
      }

      const stats = fs.statSync(this.dbPath);
      return stats.size;
    } catch (err) {
      console.error("[SQLiteAuditStore] Error getting storage size:", err);
      return 0;
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Initialize the database schema on first run.
   */
  private initializeSchema(): void {
    this.initializeSchemaWithRetry(0);
  }

  private initializeSchemaWithRetry(retryCount: number): void {
    const maxRetries = 3;
    const handleSchemaFailure = (err: unknown): void => {
      console.error("[SQLiteAuditStore] Schema initialization failed:", err);

      if (retryCount >= maxRetries) {
        throw new Error(`Schema initialization failed after ${maxRetries} attempts: ${err}`);
      }

      if (
        this.dbPath !== ":memory:" &&
        err instanceof Error &&
        (err as any).code === "SQLITE_IOERR_SHORT_READ"
      ) {
        // Attempt recovery from potential DB corruption due to partial write.
        try {
          this.db.close();
          if (fs.existsSync(this.dbPath)) {
            fs.unlinkSync(this.dbPath);
          }
        } catch (cleanupErr) {
          console.error("[SQLiteAuditStore] Recovery cleanup failed:", cleanupErr);
        }

        // Recreate database and reinitialize PRAGMAs.
        this.db = new Database(this.dbPath);
        this.db.exec("PRAGMA journal_mode = WAL");
        this.db.exec("PRAGMA synchronous = NORMAL");
        this.db.exec("PRAGMA integrity_check");

        // Try again with incremented retry count.
        this.initializeSchemaWithRetry(retryCount + 1);
        return;
      }

      throw err;
    };

    try {
      // Check if table exists
      const tableExists = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_events'")
        .get();

      if (!tableExists) {
        // Create table
        this.db.exec(`
          CREATE TABLE audit_events (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            target TEXT NOT NULL,
            result TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            lane_id TEXT,
            session_id TEXT,
            correlation_id TEXT NOT NULL,
            metadata TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          ) WITHOUT ROWID;
        `);

        // Create indexes for efficient querying
        this.db.exec(`
          CREATE INDEX idx_workspace_id ON audit_events(workspace_id);
          CREATE INDEX idx_lane_id ON audit_events(lane_id);
          CREATE INDEX idx_session_id ON audit_events(session_id);
          CREATE INDEX idx_actor ON audit_events(actor);
          CREATE INDEX idx_event_type ON audit_events(event_type);
          CREATE INDEX idx_correlation_id ON audit_events(correlation_id);
          CREATE INDEX idx_timestamp ON audit_events(timestamp);
          CREATE INDEX idx_workspace_timestamp ON audit_events(workspace_id, timestamp);
        `);
      }
    } catch (err) {
      handleSchemaFailure(err);
    }
  }

  /**
   * Convert a database row to an AuditEvent.
   *
   * @param row - Database row
   * @returns AuditEvent
   */
  private rowToEvent(row: any): AuditEvent {
    return {
      id: row.id,
      eventType: row.event_type,
      actor: row.actor,
      action: row.action,
      target: row.target,
      result: row.result,
      timestamp: row.timestamp,
      workspaceId: row.workspace_id,
      laneId: row.lane_id,
      sessionId: row.session_id,
      correlationId: row.correlation_id,
      metadata: JSON.parse(row.metadata),
    };
  }
}
