import type { AuditEvent } from "./event";

/**
 * Filter options for ring buffer queries.
 */
export interface AuditFilter {
  workspaceId?: string;
  laneId?: string;
  sessionId?: string;
  actor?: string;
  eventType?: string;
  correlationId?: string;
  startTime?: Date;
  endTime?: Date;
}

/**
 * Metrics for ring buffer monitoring.
 */
export interface RingBufferMetrics {
  capacity: number;
  currentSize: number;
  totalEventsProcessed: number;
  totalEventsEvicted: number;
}

/**
 * In-memory ring buffer for fast access to recent audit events.
 * O(1) append and O(1) random access; O(n) queries on buffer contents.
 * Thread-safe for single-threaded Bun runtime.
 */
export class AuditRingBuffer {
  private buffer: (AuditEvent | undefined)[];
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;
  private totalEventsProcessed: number = 0;
  private totalEventsEvicted: number = 0;

  /**
   * Create a new ring buffer with specified capacity.
   *
   * @param capacity - Maximum number of events to hold (default 10,000)
   */
  constructor(private capacity: number = 10_000) {
    this.buffer = Array.from({ length: capacity });
  }

  /**
   * Push an event into the buffer.
   * If buffer is full, evicts the oldest event.
   *
   * @param event - Event to push
   * @returns The evicted event if buffer was full, undefined otherwise
   */
  push(event: AuditEvent): AuditEvent | undefined {
    this.totalEventsProcessed++;

    let evicted: AuditEvent | undefined;

    if (this.size === this.capacity) {
      // Buffer is full; evict the oldest event at head and advance head
      evicted = this.buffer[this.head];
      this.totalEventsEvicted++;
      this.buffer[this.tail] = event;
      this.tail = (this.tail + 1) % this.capacity;
      this.head = (this.head + 1) % this.capacity;
    } else {
      // Buffer not yet full; append and grow
      this.buffer[this.tail] = event;
      this.tail = (this.tail + 1) % this.capacity;
      this.size++;
    }

    return evicted;
  }

  /**
   * Get the N most recent events.
   *
   * @param count - Number of events to return
   * @returns Array of recent events (most recent last)
   */
  getRecent(count: number): AuditEvent[] {
    if (count <= 0 || this.size === 0) {
      return [];
    }

    const limit = Math.min(count, this.size);
    const result: AuditEvent[] = [];

    // Start from the most recent (tail - 1) and go backwards
    for (let i = 0; i < limit; i++) {
      const index = (this.tail - 1 - i + this.capacity * 100) % this.capacity;
      const event = this.buffer[index];
      if (event) {
        result.unshift(event);
      }
    }

    return result;
  }

  /**
   * Query events in the buffer by filter criteria.
   *
   * @param filter - Filter conditions
   * @returns Array of matching events
   */
  query(filter: AuditFilter): AuditEvent[] {
    const result: AuditEvent[] = [];

    for (let i = 0; i < this.size; i++) {
      const index = (this.head + i) % this.capacity;
      const event = this.buffer[index];

      if (!event) continue;

      if (!this.matchesFilter(event, filter)) {
        continue;
      }

      result.push(event);
    }

    return result;
  }

  /**
   * Get all events with a given correlation ID.
   *
   * @param correlationId - Correlation ID to search for
   * @returns Array of matching events
   */
  getByCorrelationId(correlationId: string): AuditEvent[] {
    return this.query({ correlationId: correlationId as any });
  }

  /**
   * Get current size of buffer.
   *
   * @returns Number of events currently in buffer
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Get metrics for monitoring.
   *
   * @returns RingBufferMetrics
   */
  getMetrics(): RingBufferMetrics {
    return {
      capacity: this.capacity,
      currentSize: this.size,
      totalEventsProcessed: this.totalEventsProcessed,
      totalEventsEvicted: this.totalEventsEvicted,
    };
  }

  /**
   * Check if an event matches the filter criteria.
   *
   * @param event - Event to check
   * @param filter - Filter criteria
   * @returns true if event matches
   */
  private matchesFilter(event: AuditEvent, filter: AuditFilter): boolean {
    if (filter.workspaceId && event.workspaceId !== filter.workspaceId) {
      return false;
    }

    if (filter.laneId && event.laneId !== filter.laneId) {
      return false;
    }

    if (filter.sessionId && event.sessionId !== filter.sessionId) {
      return false;
    }

    if (filter.actor && event.actor !== filter.actor) {
      return false;
    }

    if (filter.eventType && event.eventType !== filter.eventType) {
      return false;
    }

    if (filter.startTime) {
      const eventTime = new Date(event.timestamp);
      if (eventTime < filter.startTime) {
        return false;
      }
    }

    if (filter.correlationId && event.correlationId !== filter.correlationId) {
      return false;
    }

    if (filter.endTime) {
      const eventTime = new Date(event.timestamp);
      if (eventTime > filter.endTime) {
        return false;
      }
    }

    return true;
  }
}
