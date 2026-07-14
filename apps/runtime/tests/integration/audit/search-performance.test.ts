/**
 * FR-HELIOS-091: Audit Search Performance Tests
 * Verifies: FR-AUD-005 (Search/filter performance)
 */
let _stubDateNow: () => number;
let _stubUUID: () => string;
let _uuidCounter = 0;
import { AuditLedger } from "../../../src/audit/ledger";
import { AuditRingBuffer } from "../../../src/audit/ring-buffer";
import { SQLiteAuditStore } from "../../../src/audit/sqlite-store";
import { createAuditEvent, AUDIT_EVENT_TYPES, AUDIT_EVENT_RESULTS } from "../../../src/audit/event";

/**
 * Calculate percentile from array of values.
 */
function percentile(values: number[], p: number): number {
  values.sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * values.length) - 1;
  return values[Math.max(0, index)];
}

describe("Audit Search Performance", { timeout: 60000 }, () => {
  let ledger: AuditLedger;
  let ringBuffer: AuditRingBuffer;
  let store: SQLiteAuditStore;

  beforeEach(() => {
    ringBuffer = new AuditRingBuffer(10_000);
    store = new SQLiteAuditStore(":memory:");
    ledger = new AuditLedger(ringBuffer, store);
  });

  afterEach(() => {
    store.close();
  });

  it("should search with workspace filter in < 500ms p95 for large dataset", async () => {
    // Insert 100k events (sample from 1M scale test)
    const events = [];
    const WORKSPACES = 10;
    const ACTORS = 50;
    const EVENT_TYPES = 5;

    for (let i = 0; i < 100_000; i++) {
      const event = createAuditEvent({
        eventType: [
          AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
          AUDIT_EVENT_TYPES.SESSION_CREATED,
          AUDIT_EVENT_TYPES.POLICY_EVALUATION,
          AUDIT_EVENT_TYPES.APPROVAL_RESOLVED,
          AUDIT_EVENT_TYPES.TERMINAL_OUTPUT,
        ][i % EVENT_TYPES],
        actor: `actor-${i % ACTORS}`,
        action: "test",
        target: `target-${i}`,
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: `ws-${i % WORKSPACES}`,
        laneId: `lane-${i % 50}`,
        sessionId: `session-${i % 100}`,
        correlationId: `corr-${i}`,
        metadata: { index: i },
      });
      events.push(event);

      // Insert to ring buffer for first 10k
      if (i < 10_000) {
        ringBuffer.push(event);
      }
    }

    // Persist rest to SQLite
    await store.persist(events.slice(10_000));

    // Run multiple searches and collect latencies
    const latencies: number[] = [];

    for (let i = 0; i < 20; i++) {
      const _startTime = Date.now();
      const _results = ledger.search({ workspaceId: "ws-0", limit: 100 });
      const endTime = Date.now();

      latencies.push(endTime - startTime);
      expect(results.length).toBeGreaterThan(0);
    }

    const p95 = percentile(latencies, 95);

    console.log(`Workspace filter search p95: ${p95}ms`);
    expect(p95).toBeLessThan(500);
  });

  it("should search with time range filter in < 500ms p95", async () => {
    // Insert events with various timestamps
    const events = [];
    const now = new Date();

    for (let i = 0; i < 50_000; i++) {
      // Create events spread across 1 day
      const timestamp = new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000);

      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: "agent-1",
        action: "execute",
        target: `cmd-${i}`,
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: "ws-1",
        correlationId: `corr-${i}`,
        metadata: {},
      });

      // Manually override timestamp
      (event as any).timestamp = timestamp.toISOString();
      events.push(event);
    }

    await store.persist(events);

    // Search with time range
    const latencies: number[] = [];
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const now2 = now;

    for (let i = 0; i < 20; i++) {
      const _startTime = Date.now();
      const _results = ledger.search({
        timeRange: { from: oneHourAgo, to: now2 },
        limit: 100,
      });
      const endTime = Date.now();

      latencies.push(endTime - startTime);
    }

    const p95 = percentile(latencies, 95);

    console.log(`Time range filter search p95: ${p95}ms`);
    expect(p95).toBeLessThan(500);
  });

  it("should search with combined filters in < 500ms p95", async () => {
    // Insert diverse events
    const events = [];

    for (let i = 0; i < 50_000; i++) {
      const event = createAuditEvent({
        eventType:
          i % 3 === 0 ? AUDIT_EVENT_TYPES.COMMAND_EXECUTED : AUDIT_EVENT_TYPES.SESSION_CREATED,
        actor: `actor-${i % 20}`,
        action: "test",
        target: `target-${i}`,
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: `ws-${i % 5}`,
        correlationId: `corr-${i}`,
        metadata: {},
      });
      events.push(event);
    }

    await store.persist(events);

    // Run combined filter searches
    const latencies: number[] = [];

    for (let i = 0; i < 20; i++) {
      const _startTime = Date.now();
      const _results = ledger.search({
        workspaceId: "ws-0",
        actor: "actor-0",
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        limit: 100,
      });
      const endTime = Date.now();

      latencies.push(endTime - startTime);
    }

    const p95 = percentile(latencies, 95);

    console.log(`Combined filter search p95: ${p95}ms`);
    expect(p95).toBeLessThan(500);
  });

  it("should traverse correlation chains in < 500ms p95", async () => {
    // Create chains of correlated events
    const CHAIN_COUNT = 100;
    const CHAIN_LENGTH = 10;

    for (let chainIdx = 0; chainIdx < CHAIN_COUNT; chainIdx++) {
      const events = [];
      const correlationId = `chain-${chainIdx}`;

      for (let eventIdx = 0; eventIdx < CHAIN_LENGTH; eventIdx++) {
        const event = createAuditEvent({
          eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATION,
          actor: "system",
          action: "evaluate",
          target: `target-${chainIdx}-${eventIdx}`,
          result: AUDIT_EVENT_RESULTS.SUCCESS,
          workspaceId: "ws-1",
          correlationId,
          metadata: { chainIndex: chainIdx, eventIndex: eventIdx },
        });
        events.push(event);
      }

      await store.persist(events);
    }

    // Traverse chains and measure latency
    const latencies: number[] = [];

    for (let i = 0; i < CHAIN_COUNT; i++) {
      const _startTime = Date.now();
      const chain = ledger.getCorrelationChain(`chain-${i}`);
      const endTime = Date.now();

      latencies.push(endTime - startTime);
      expect(chain.length).toBeGreaterThanOrEqual(CHAIN_LENGTH * 0.99); // 99% completeness
    }

    const p95 = percentile(latencies, 95);

    console.log(`Correlation chain traversal p95: ${p95}ms`);
    expect(p95).toBeLessThan(500);
  });

  it("should document storage efficiency", async () => {
    // Insert 100k events
    const events = [];

    for (let i = 0; i < 100_000; i++) {
      const event = createAuditEvent({
        eventType: AUDIT_EVENT_TYPES.COMMAND_EXECUTED,
        actor: `actor-${i % 50}`,
        action: "execute",
        target: `cmd-${i}`,
        result: AUDIT_EVENT_RESULTS.SUCCESS,
        workspaceId: `ws-${i % 10}`,
        correlationId: `corr-${i}`,
        metadata: {
          index: i,
          duration: Math.floor(Math.random() * 1000),
          exitCode: i % 5 === 0 ? 1 : 0,
        },
      });
      events.push(event);
    }

    await store.persist(events);

    const count = store.count();
    const size = store.getStorageSize();
    const sizePerEvent = size / count;

    console.log(`Storage efficiency: ${sizePerEvent.toFixed(2)} bytes per event`);
    console.log(`100k events: ${(size / 1024 / 1024).toFixed(2)} MB`);

    // 3M events should be < 500MB
    const projectedSize = (3_000_000 / count) * size;
    console.log(`Projected 3M events: ${(projectedSize / 1024 / 1024).toFixed(2)} MB`);

    expect(projectedSize).toBeLessThan(500 * 1024 * 1024);
  });
});
