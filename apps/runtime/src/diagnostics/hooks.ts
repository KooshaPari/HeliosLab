// FR-008: Monotonic clock wrapper and zero-allocation markStart/markEnd API.

// ── Clock interface ────────────────────────────────────────────────────

/**
 * Injectable clock interface for testability.
 * Default implementation uses `performance.now()` (monotonic, sub-ms precision).
 *
 * Minimum expected precision: 5 microseconds on modern platforms.
 * Actual resolution varies — browsers may clamp to 100us for Spectre mitigations;
 * Bun / Node expose full OS timer resolution.
 */
export interface MonotonicClock {
  now(): number;
}

// Fail-fast: ensure performance.now is available at module load.
if (typeof performance === "undefined" || typeof performance.now !== "function") {
  throw new Error(
    "performance.now() is required for monotonic timing but is unavailable in this environment."
  );
}

const defaultClock: MonotonicClock = { now: () => performance.now() };

/** Returns the current monotonic timestamp in milliseconds (sub-ms precision). */
export function monotonicNow(): number {
  return performance.now();
}

// ── Mark start / end API ───────────────────────────────────────────────

/** Default maximum number of concurrent in-flight marks. */
const DEFAULT_MAX_CONCURRENT_MARKS = 1024;

/**
 * Internal state for the global instrumentation hooks.
 * Separated into a struct so `createInstrumentationHooks` can produce
 * isolated instances (useful for tests).
 */
interface HooksState {
  readonly startTimes: Float64Array;
  readonly metricNames: string[];
  nextSlot: number;
  totalMarks: number;
  overflowCount: number;
  clock: MonotonicClock;
  /** Callback to record a sample once markEnd computes a duration. */
  onSample: ((metric: string, value: number, timestamp: number) => void) | undefined;
}

function createState(maxConcurrent: number, clock: MonotonicClock): HooksState {
  return {
    startTimes: new Float64Array(maxConcurrent),
    metricNames: Array.from({ length: maxConcurrent }, () => ""),
    nextSlot: 0,
    totalMarks: 0,
    overflowCount: 0,
    clock,
    onSample: undefined,
  };
}

// ── Global singleton state ─────────────────────────────────────────────

let globalState: HooksState = createState(DEFAULT_MAX_CONCURRENT_MARKS, defaultClock);

/**
 * Begin a latency measurement.
 *
 * Records `monotonicNow()` into a pre-allocated Float64Array slot.
 * Returns a numeric handle (slot index) — **no object allocation**.
 *
 * If all slots are in use the oldest is overwritten and an overflow
 * counter is incremented.
 */
export function markStart(metric: string): number {
  const s = globalState;
  const slot = s.nextSlot;

  // Detect wrap / overwrite of an unconsumed mark.
  if (s.totalMarks >= s.startTimes.length && s.metricNames[slot] !== "") {
    s.overflowCount++;
  }

  s.startTimes[slot] = s.clock.now();
  s.metricNames[slot] = metric;
  s.nextSlot = (slot + 1) % s.startTimes.length;
  s.totalMarks++;

  return slot;
}

/**
 * End a latency measurement previously started with `markStart`.
 *
 * Computes duration as `now - startTimes[handle]`.
 * Returns the duration in milliseconds, or `NaN` if the handle is stale /
 * invalid (with a console warning).
 *
 * **No object allocation on the hot path.**
 */
export function markEnd(metric: string, handle: number): number {
  const s = globalState;

  // Guard: out-of-range handle.
  if (handle < 0 || handle >= s.startTimes.length) {
    console.warn(`[perf] markEnd called with out-of-range handle ${handle}`);
    return NaN;
  }

  // Guard: stale / mismatched handle.
  if (s.metricNames[handle] !== metric) {
    console.warn(
      `[perf] markEnd handle ${handle} expected metric "${metric}" but found "${s.metricNames[handle]}" (stale?)`
    );
    return NaN;
  }

  const end = s.clock.now();
  const duration = end - s.startTimes[handle]!;

  // Clear slot so it can be reused.
  s.metricNames[handle] = "";

  // Notify registry if wired up.
  if (s.onSample !== undefined) {
    s.onSample(metric, duration, end);
  }

  return duration;
}

/** Number of mark-start slots that were overwritten before being consumed. */
export function _getMarkOverflowCount(): number {
  return globalState.overflowCount;
}

// ── Factory for isolated instances (testing) ───────────────────────────

export interface InstrumentationHooks {
  markStart(metric: string): number;
  markEnd(metric: string, handle: number): number;
  getOverflowCount(): number;
  setOnSample(cb: (metric: string, value: number, timestamp: number) => void): void;
}

/**
 * Create an isolated set of instrumentation hooks — mainly for unit tests
 * that need deterministic clocks or independent overflow counters.
 */
export function createInstrumentationHooks(opts?: {
  maxConcurrent?: number;
  clock?: MonotonicClock;
}): InstrumentationHooks {
  const maxConcurrent = opts?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_MARKS;
  const clock = opts?.clock ?? defaultClock;
  const state = createState(maxConcurrent, clock);

  return {
    markStart(metric: string): number {
      const slot = state.nextSlot;
      if (state.totalMarks >= state.startTimes.length && state.metricNames[slot] !== "") {
        state.overflowCount++;
      }
      state.startTimes[slot] = state.clock.now();
      state.metricNames[slot] = metric;
      state.nextSlot = (slot + 1) % state.startTimes.length;
      state.totalMarks++;
      return slot;
    },

    markEnd(metric: string, handle: number): number {
      if (handle < 0 || handle >= state.startTimes.length) {
        console.warn(`[perf] markEnd called with out-of-range handle ${handle}`);
        return NaN;
      }
      if (state.metricNames[handle] !== metric) {
        console.warn(
          `[perf] markEnd handle ${handle} expected metric "${metric}" but found "${state.metricNames[handle]}" (stale?)`
        );
        return NaN;
      }
      const end = state.clock.now();
      const duration = end - state.startTimes[handle]!;
      state.metricNames[handle] = "";
      if (state.onSample !== undefined) {
        state.onSample(metric, duration, end);
      }
      return duration;
    },

    getOverflowCount(): number {
      return state.overflowCount;
    },

    setOnSample(cb: (metric: string, value: number, timestamp: number) => void): void {
      state.onSample = cb;
    },
  };
}

/**
 * Wire the global hooks to forward samples to a callback (typically MetricsRegistry.record).
 * Returns a teardown function.
 */
export function setGlobalOnSample(
  cb: (metric: string, value: number, timestamp: number) => void
): () => void {
  globalState.onSample = cb;
  return () => {
    globalState.onSample = undefined;
  };
}

/**
 * Replace the global hooks state — mainly for tests that need to reset
 * between runs. Not intended for production use.
 */
export function _resetGlobalHooks(opts?: { maxConcurrent?: number; clock?: MonotonicClock }): void {
  globalState = createState(
    opts?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_MARKS,
    opts?.clock ?? defaultClock
  );
}
