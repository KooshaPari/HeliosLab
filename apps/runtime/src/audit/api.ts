import { AuditLedger, type AuditFilter } from "./ledger";

/**
 * API response wrapper for paginated results.
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * API response for errors.
 */
export interface ErrorResponse {
  error: string;
  details?: string;
}

/**
 * Audit ledger HTTP API handler.
 * Provides endpoints for searching, filtering, and subscribing to audit events.
 */
export class AuditLedgerAPI {
  private requestCounts: Map<string, number> = new Map();
  private requestResetTime: number = Date.now();
  private readonly RATE_LIMIT = 100; // 100 requests per minute
  private readonly RATE_LIMIT_WINDOW = 60_000; // 1 minute

  constructor(private ledger: AuditLedger) {
    // Start rate limit reset timer
    setInterval(() => {
      this.requestCounts.clear();
      this.requestResetTime = Date.now();
    }, this.RATE_LIMIT_WINDOW);
  }

  /**
   * GET /audit/events
   * Search for audit events with multi-dimensional filtering.
   */
  searchEvents(
    clientId: string,
    queryParams: Record<string, any>
  ): PaginatedResponse<any> | ErrorResponse {
    if (!this.checkRateLimit(clientId)) {
      return {
        error: "Too many requests",
        details: "Rate limit exceeded: 100 requests per minute",
      };
    }

    try {
      const filter = this.parseAuditFilter(queryParams);
      const results = this.ledger.search(filter);

      const total = this.ledger.count(filter);

      return {
        data: results,
        total,
        limit: filter.limit || 100,
        offset: filter.offset || 0,
      };
    } catch (err) {
      return {
        error: "Invalid search parameters",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * GET /audit/events/:correlationId/chain
   * Get the complete correlation chain for a given ID.
   */
  getCorrelationChain(
    clientId: string,
    correlationId: string
  ): PaginatedResponse<any> | ErrorResponse {
    if (!this.checkRateLimit(clientId)) {
      return {
        error: "Too many requests",
        details: "Rate limit exceeded: 100 requests per minute",
      };
    }

    try {
      if (!correlationId || typeof correlationId !== "string") {
        return {
          error: "Invalid correlation ID",
        };
      }

      const chain = this.ledger.getCorrelationChain(correlationId);

      return {
        data: chain,
        total: chain.length,
        limit: chain.length,
        offset: 0,
      };
    } catch (err) {
      return {
        error: "Error retrieving correlation chain",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * GET /audit/events/count
   * Count events matching a filter.
   */
  countEvents(
    clientId: string,
    queryParams: Record<string, any>
  ): { count: number } | ErrorResponse {
    if (!this.checkRateLimit(clientId)) {
      return {
        error: "Too many requests",
        details: "Rate limit exceeded: 100 requests per minute",
      };
    }

    try {
      const filter = this.parseAuditFilter(queryParams);
      const count = this.ledger.count(filter);

      return { count };
    } catch (err) {
      return {
        error: "Invalid filter parameters",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Parse query parameters into an AuditFilter.
   */
  private parseAuditFilter(queryParams: Record<string, any>): AuditFilter {
    const filter: AuditFilter = {};

    if (queryParams.workspaceId && typeof queryParams.workspaceId === "string") {
      filter.workspaceId = queryParams.workspaceId;
    }

    if (queryParams.laneId && typeof queryParams.laneId === "string") {
      filter.laneId = queryParams.laneId;
    }

    if (queryParams.sessionId && typeof queryParams.sessionId === "string") {
      filter.sessionId = queryParams.sessionId;
    }

    if (queryParams.actor && typeof queryParams.actor === "string") {
      filter.actor = queryParams.actor;
    }

    if (queryParams.eventType) {
      if (Array.isArray(queryParams.eventType)) {
        filter.eventType = queryParams.eventType;
      } else if (typeof queryParams.eventType === "string") {
        filter.eventType = queryParams.eventType;
      }
    }

    if (queryParams.correlationId && typeof queryParams.correlationId === "string") {
      filter.correlationId = queryParams.correlationId;
    }

    if (queryParams.from || queryParams.to) {
      const from = queryParams.from ? new Date(queryParams.from) : new Date(0);
      const to = queryParams.to ? new Date(queryParams.to) : new Date();

      if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
        filter.timeRange = { from, to };
      } else {
        throw new Error("Invalid time range parameters");
      }
    }

    if (queryParams.limit) {
      const limit = parseInt(queryParams.limit, 10);
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        throw new Error("Limit must be between 1 and 1000");
      }
      filter.limit = limit;
    }

    if (queryParams.offset) {
      const offset = parseInt(queryParams.offset, 10);
      if (isNaN(offset) || offset < 0) {
        throw new Error("Offset must be >= 0");
      }
      filter.offset = offset;
    }

    return filter;
  }

  /**
   * Check and enforce rate limiting per client.
   */
  private checkRateLimit(clientId: string): boolean {
    const count = (this.requestCounts.get(clientId) || 0) + 1;
    this.requestCounts.set(clientId, count);

    return count <= this.RATE_LIMIT;
  }
}
