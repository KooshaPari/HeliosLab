/**
 * Stress test — overflow with 50MB output into 4MB buffer.
 *
 * Verifies:
 * - Capacity is never exceeded
 * - Drops are correctly counted
 * - Overflow events are emitted
 * - Event loop remains responsive
 */

import { describe, expect, it } from "bun:test";
import { OutputBuffer } from "../../../src/pty/buffers.js";
import { InMemoryBusPublisher } from "../../../src/pty/events.js";
import type { PtyEventCorrelation } from "../../../src/pty/events.js";

function makeCorrelation(): PtyEventCorrelation {
  return {
    ptyId: "pty-stress-1",
    laneId: "lane-1",
    sessionId: "session-1",
    terminalId: "term-1",
    correlationId: "corr-stress-1",
  };
}

describe("Buffer stress test — 50MB into 4MB buffer", () => {
  it("handles 50MB of output without exceeding capacity", () => {
    const origWarn = console.warn;
    console.warn = () => {};

    try {
      const bus = new InMemoryBusPublisher();
      const CAPACITY = 4 * 1024 * 1024; // 4MB
      const ob = new OutputBuffer(bus, makeCorrelation(), {
        capacityBytes: CAPACITY,
        overflowDebounceMs: 0, // allow all overflow events for testing
      });

      const TOTAL_DATA = 50 * 1024 * 1024; // 50MB
      const CHUNK_SIZE = 64 * 1024; // 64KB chunks
      const chunk = new Uint8Array(CHUNK_SIZE);
      // Fill chunk with recognizable pattern.
      for (let i = 0; i < CHUNK_SIZE; i++) {
        chunk[i] = i & 0xff;
      }

      let totalWritten = 0;
      let totalDropped = 0;

      const _startTime = performance.now();
      let lastResponsivenessCheck = startTime;
      let maxTimeBetweenChecks = 0;

      for (let offset = 0; offset < TOTAL_DATA; offset += CHUNK_SIZE) {
        const result = ob.write(chunk);
        totalWritten += result.written;
        totalDropped += result.dropped;

        // Verify capacity invariant on every write.
        expect(ob.available).toBeLessThanOrEqual(CAPACITY);

        // Track event loop responsiveness.
        const now = performance.now();
        const delta = now - lastResponsivenessCheck;
        if (delta > maxTimeBetweenChecks) {
          maxTimeBetweenChecks = delta;
        }
        lastResponsivenessCheck = now;

        // Periodically consume a small amount to simulate a slow reader.
        if (offset % (4 * 1024 * 1024) === 0 && ob.available > 0) {
          ob.consume(Math.min(ob.available, 64 * 1024));
        }
      }

      const elapsedMs = performance.now() - startTime;

      // ── Assertions ──────────────────────────────────────────────

      // 1. Total written + dropped = total data.
      expect(totalWritten + totalDropped).toBe(TOTAL_DATA);

      // 2. Drops were counted (buffer is 4MB, wrote 50MB with periodic drain).
      expect(totalDropped).toBeGreaterThan(0);

      // 3. Buffer never exceeded capacity.
      expect(ob.available).toBeLessThanOrEqual(CAPACITY);

      // 4. Stats match.
      const stats = ob.getStats();
      expect(stats.totalWritten).toBe(totalWritten);
      expect(stats.totalDropped).toBe(totalDropped);
      expect(stats.capacity).toBe(CAPACITY);

      // 5. Overflow events were emitted.
      const overflowEvts = bus.events.filter(e => e.topic === "pty.buffer.overflow");
      expect(overflowEvts.length).toBeGreaterThan(0);
      expect(stats.overflowEvents).toBeGreaterThan(0);

      // 6. Event loop stayed responsive — no single iteration > 100ms.
      expect(maxTimeBetweenChecks).toBeLessThan(100);

      // 7. Completed in reasonable time (< 10 seconds for 50MB).
      expect(elapsedMs).toBeLessThan(10_000);

      console.log(
        `Stress test complete: ${(TOTAL_DATA / 1024 / 1024).toFixed(0)}MB processed in ${elapsedMs.toFixed(0)}ms, ` +
          `${totalDropped} bytes dropped, ${overflowEvts.length} overflow events`
      );
    } finally {
      console.warn = origWarn;
    }
  });

  it("handles continuous overflow without consuming", () => {
    const origWarn = console.warn;
    console.warn = () => {};

    try {
      const bus = new InMemoryBusPublisher();
      const CAPACITY = 4 * 1024 * 1024;
      const ob = new OutputBuffer(bus, makeCorrelation(), {
        capacityBytes: CAPACITY,
        overflowDebounceMs: 0,
      });

      const CHUNK_SIZE = 128 * 1024;
      const chunk = new Uint8Array(CHUNK_SIZE);
      const ITERATIONS = 500; // ~62.5MB

      for (let i = 0; i < ITERATIONS; i++) {
        ob.write(chunk);
        expect(ob.available).toBeLessThanOrEqual(CAPACITY);
      }

      const stats = ob.getStats();
      const totalData = CHUNK_SIZE * ITERATIONS;
      expect(stats.totalWritten + stats.totalDropped).toBe(totalData);
      // After first fill, almost everything should be dropped.
      expect(stats.totalDropped).toBeGreaterThan(totalData - CAPACITY - CHUNK_SIZE);
      expect(stats.overflowEvents).toBeGreaterThan(0);

      // Backpressure should be active.
      expect(ob.isBackpressured).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});
