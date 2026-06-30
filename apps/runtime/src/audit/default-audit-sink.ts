import { AuditRingBuffer } from "./ring-buffer";
import type { AuditEvent } from "./event";
import type { AuditSink, AuditSinkMetrics, AuditStorage } from "./sink-types";

const MAX_BUFFER_SIZE = 10_000;
const RETRY_BACKOFF_MS = 100;
const MAX_RETRIES = 5;
const FLUSH_INTERVAL_MS = 10_000;

function createDefaultMetrics(): AuditSinkMetrics {
  return {
    totalEventsWritten: 0,
    bufferHighWaterMark: 0,
    persistenceFailures: 0,
    retryCount: 0,
    eventsOverflowed: 0,
    sqliteWriteFailures: 0,
    sqliteRetryCount: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class DefaultAuditSink implements AuditSink {
  private buffer: AuditEvent[] = [];
  private ringBuffer: AuditRingBuffer;
  private metrics: AuditSinkMetrics = createDefaultMetrics();
  private persistenceInProgress = false;
  private flushTimer: number | null = null;
  private overflowQueue: AuditEvent[] = [];

  constructor(
    private storage: AuditStorage,
    ringBufferCapacity: number = MAX_BUFFER_SIZE
  ) {
    this.ringBuffer = new AuditRingBuffer(ringBufferCapacity);
    this.startPeriodicFlush();
  }

  async write(event: AuditEvent): Promise<void> {
    this.metrics.totalEventsWritten++;
    const evicted = this.ringBuffer.push(event);

    if (evicted) {
      this.metrics.eventsOverflowed!++;
      this.overflowQueue.push(evicted);
      this.persistOverflow().catch(err => {
        console.error("[AuditSink] Overflow persistence failed:", err);
      });
    }

    this.buffer.push(event);

    if (this.buffer.length > this.metrics.bufferHighWaterMark) {
      this.metrics.bufferHighWaterMark = this.buffer.length;
    }

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.persistWithRetry().catch(err => {
        console.error("[AuditSink] Persistence failed, events retained in buffer:", err);
      });
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 && this.overflowQueue.length === 0) {
      return;
    }

    let retries = 0;
    while ((this.buffer.length > 0 || this.overflowQueue.length > 0) && retries < MAX_RETRIES) {
      try {
        if (this.overflowQueue.length > 0) {
          await this.persistOverflow();
        }

        if (this.buffer.length > 0) {
          await this.persistWithRetry();
        }

        break;
      } catch {
        retries++;
        if (retries >= MAX_RETRIES) {
          throw new Error(`[AuditSink] Failed to flush after ${MAX_RETRIES} retries: ${err}`);
        }
        await sleep(RETRY_BACKOFF_MS * retries);
      }
    }
  }

  getBufferedCount(): number {
    return this.buffer.length;
  }

  getMetrics(): AuditSinkMetrics {
    return { ...this.metrics };
  }

  destroy(): void {
    this.stopPeriodicFlush();
  }

  private async persistWithRetry(): Promise<void> {
    if (this.persistenceInProgress || this.buffer.length === 0) {
      return;
    }

    this.persistenceInProgress = true;

    try {
      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          const eventsToPersist = [...this.buffer];
          await this.storage.persist(eventsToPersist);
          this.buffer = [];
          break;
        } catch {
          this.metrics.persistenceFailures++;
          this.metrics.retryCount++;
          retries++;
          if (retries < MAX_RETRIES) {
            await sleep(RETRY_BACKOFF_MS * Math.pow(2, retries - 1));
          }
        }
      }

      if (this.buffer.length > 0) {
        console.warn(
          "[AuditSink] Events retained in buffer after retries; will retry on next write"
        );
      }
    } finally {
      this.persistenceInProgress = false;
    }
  }

  private async persistOverflow(): Promise<void> {
    if (this.overflowQueue.length === 0) {
      return;
    }

    let retries = 0;
    while (retries < MAX_RETRIES && this.overflowQueue.length > 0) {
      try {
        const eventsToPersist = [...this.overflowQueue];
        await this.storage.persist(eventsToPersist);
        this.overflowQueue = [];
        break;
      } catch {
        this.metrics.sqliteWriteFailures!++;
        this.metrics.sqliteRetryCount!++;
        retries++;
        if (retries < MAX_RETRIES) {
          await sleep(RETRY_BACKOFF_MS * Math.pow(2, retries - 1));
        }
      }
    }
  }

  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0 || this.overflowQueue.length > 0) {
        this.persistWithRetry().catch(err => {
          console.error("[AuditSink] Periodic flush failed:", err);
        });
      }
    }, FLUSH_INTERVAL_MS) as unknown as number;
  }

  private stopPeriodicFlush(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
