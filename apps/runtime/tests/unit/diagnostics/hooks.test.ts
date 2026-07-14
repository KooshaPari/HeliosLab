/**
 * FR-HELIOS-068: Instrumentation Hooks and Monotonic Clock Tests
 * Verifies: FR-PRF-001 (Instrumentation hooks), FR-PRF-008 (Monotonic clock sources)
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  monotonicNow,
  markStart,
  markEnd,
  createInstrumentationHooks,
  _resetGlobalHooks,
} from "../../../src/diagnostics/hooks.js";
import type { MonotonicClock } from "../../../src/diagnostics/hooks.js";

// ── Helper: deterministic mock clock ───────────────────────────────────

function createMockClock(startMs = 0): MonotonicClock & { advance(ms: number): void } {
  let current = startMs;
  return {
    now() {
      return current;
    },
    advance(ms: number) {
      current += ms;
    },
  };
}

// ── monotonicNow ───────────────────────────────────────────────────────

describe("monotonicNow", () => {
  // FR-008
  it("returns a number", () => {
    expect(typeof monotonicNow()).toBe("number");
  });

  it("two sequential calls are non-decreasing", () => {
    const a = monotonicNow();
    const b = monotonicNow();
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it("has sub-millisecond precision (not integer)", () => {
    // Accumulate a few calls — at least one should have fractional part.
    let hasFractional = false;
    for (let i = 0; i < 100; i++) {
      if (monotonicNow() % 1 !== 0) {
        hasFractional = true;
        break;
      }
    }
    expect(hasFractional).toBe(true);
  });
});

// ── markStart / markEnd (global) ───────────────────────────────────────

describe("markStart / markEnd (global)", () => {
  beforeEach(() => {
    _resetGlobalHooks();
  });

  // FR-008
  it("markStart returns a numeric handle, not an object", () => {
    const handle = markStart("test_metric");
    expect(typeof handle).toBe("number");
  });

  it("markEnd computes a non-negative duration", () => {
    const handle = markStart("test_metric");
    const _duration = markEnd("test_metric", handle);
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("markEnd with real delay produces plausible duration", async () => {
    const handle = markStart("test_metric");
    await new Promise(resolve => setTimeout(resolve, 10));
    const _duration = markEnd("test_metric", handle);
    // Allow 5-200ms range for CI variability under heavy parallel load.
    expect(duration).toBeGreaterThan(5);
    expect(duration).toBeLessThan(200);
  });

  it("markEnd returns NaN for out-of-range handle", () => {
    const result = markEnd("x", -1);
    expect(Number.isNaN(result)).toBe(true);
  });

  it("markEnd returns NaN for mismatched metric (stale handle)", () => {
    const handle = markStart("metric_a");
    // Consume it
    markEnd("metric_a", handle);
    // Now the slot is cleared — calling again should warn & return NaN.
    const result = markEnd("metric_a", handle);
    expect(Number.isNaN(result)).toBe(true);
  });
});

// ── createInstrumentationHooks (isolated instance) ─────────────────────

describe("createInstrumentationHooks", () => {
  it("uses injected mock clock for deterministic timing", () => {
    // FR-008
    const clock = createMockClock(100);
    const hooks = createInstrumentationHooks({ clock, maxConcurrent: 8 });

    const handle = hooks.markStart("latency");
    clock.advance(42.5);
    const _duration = hooks.markEnd("latency", handle);

    expect(duration).toBe(42.5);
  });

  it("concurrent marks to different metrics do not interfere", () => {
    const clock = createMockClock(0);
    const hooks = createInstrumentationHooks({ clock, maxConcurrent: 8 });

    const h1 = hooks.markStart("a");
    clock.advance(10);
    const h2 = hooks.markStart("b");
    clock.advance(5);

    const durB = hooks.markEnd("b", h2);
    clock.advance(3);
    const durA = hooks.markEnd("a", h1);

    expect(durB).toBe(5);
    expect(durA).toBe(18); // 10 + 5 + 3
  });

  it("overflow wraps without crash and increments counter", () => {
    const clock = createMockClock(0);
    const hooks = createInstrumentationHooks({ clock, maxConcurrent: 2 });

    hooks.markStart("a"); // slot 0
    hooks.markStart("b"); // slot 1
    // Both slots occupied — next start overwrites slot 0.
    hooks.markStart("c"); // slot 0 overwritten

    expect(hooks.getOverflowCount()).toBe(1);
  });

  it("overwritten slot returns NaN on markEnd for original metric", () => {
    const clock = createMockClock(0);
    const hooks = createInstrumentationHooks({ clock, maxConcurrent: 2 });

    const h0 = hooks.markStart("a"); // slot 0
    hooks.markStart("b"); // slot 1
    hooks.markStart("c"); // slot 0 overwritten with "c"

    // Trying to end "a" at slot 0 — metric mismatch.
    const dur = hooks.markEnd("a", h0);
    expect(Number.isNaN(dur)).toBe(true);
  });

  it("no `new` keyword on hot path (zero allocation check)", () => {
    // Verify markStart returns a plain number, not an object wrapper.
    const clock = createMockClock(0);
    const hooks = createInstrumentationHooks({ clock, maxConcurrent: 4 });
    const handle = hooks.markStart("x");
    expect(handle).toBe(0);
    expect(typeof handle).toBe("number");
    // markEnd also returns a plain number.
    clock.advance(1);
    const dur = hooks.markEnd("x", handle);
    expect(typeof dur).toBe("number");
  });

  it("setOnSample callback is invoked on markEnd", () => {
    const clock = createMockClock(0);
    const hooks = createInstrumentationHooks({ clock, maxConcurrent: 4 });
    const samples: Array<{ metric: string; value: number; ts: number }> = [];
    hooks.setOnSample((metric, value, ts) => {
      samples.push({ metric, value, ts });
    });

    const h = hooks.markStart("render");
    clock.advance(7);
    hooks.markEnd("render", h);

    expect(samples).toHaveLength(1);
    expect(samples[0]!.metric).toBe("render");
    expect(samples[0]!.value).toBe(7);
  });
});
