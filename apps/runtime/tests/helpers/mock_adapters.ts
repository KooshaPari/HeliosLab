/**
 * Shared mock renderer adapters for unit and integration tests.
 *
 * MockGhosttyAdapter and MockRioAdapter implement RendererAdapter with
 * configurable success/failure behavior and delay simulation.
 */

import type {
  RendererAdapter,
  RendererConfig,
  RenderSurface,
  RendererState,
} from "../../src/renderer/adapter.js";
import type { RendererCapabilities } from "../../src/renderer/capabilities.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MockAdapterOptions {
  /** Fail on init(). */
  initFail?: boolean;
  /** Fail on start(). */
  startFail?: boolean;
  /** Fail on stop(). */
  stopFail?: boolean;
  /** Delay in ms for init(). */
  initDelayMs?: number;
  /** Delay in ms for start(). */
  startDelayMs?: number;
  /** Delay in ms for stop(). */
  stopDelayMs?: number;
  /** Custom capabilities. */
  capabilities?: Partial<RendererCapabilities>;
  /** Fail after N calls to init (for testing progressive failures). */
  initFailAfter?: number;
}

const DEFAULT_CAPS: RendererCapabilities = {
  gpuAccelerated: true,
  colorDepth: 24,
  ligatureSupport: true,
  maxDimensions: { cols: 200, rows: 50 },
  inputModes: ["raw"],
  sixelSupport: false,
  italicSupport: true,
  strikethroughSupport: true,
};

// ---------------------------------------------------------------------------
// Base mock
// ---------------------------------------------------------------------------

export class BaseMockAdapter implements RendererAdapter {
  readonly id: string;
  readonly version: string;
  private _state: RendererState = "uninitialized";
  private _opts: MockAdapterOptions;
  private _crashHandler?: (error: Error) => void;
  private _initCallCount = 0;

  /** Streams currently bound to this adapter. */
  readonly boundStreams = new Map<string, ReadableStream<Uint8Array>>();
  /** Input data received via handleInput. */
  readonly receivedInput: Array<{ ptyId: string; data: Uint8Array }> = [];
  /** Resize calls received. */
  readonly resizeCalls: Array<{ ptyId: string; cols: number; rows: number }> = [];
  /** Track method call counts for assertions. */
  readonly callCounts = {
    init: 0,
    start: 0,
    stop: 0,
    bindStream: 0,
    unbindStream: 0,
    handleInput: 0,
  };

  constructor(id: string, version: string = "1.0.0", opts: MockAdapterOptions = {}) {
    this.id = id;
    this.version = version;
    this._opts = opts;
  }

  /** Update options dynamically (e.g., to inject failure mid-test). */
  setOptions(opts: Partial<MockAdapterOptions>): void {
    this._opts = { ...this._opts, ...opts };
  }

  private async _delay(ms?: number): Promise<void> {
    if (ms && ms > 0) {
      await new Promise(r => setTimeout(r, ms));
    }
  }

  async init(_config: RendererConfig): Promise<void> {
    this.callCounts.init++;
    this._initCallCount++;
    await this._delay(this._opts.initDelayMs);

    if (this._opts.initFailAfter !== undefined && this._initCallCount > this._opts.initFailAfter) {
      this._state = "errored";
      throw new Error(`${this.id} init failed (after ${this._opts.initFailAfter} calls)`);
    }

    if (this._opts.initFail) {
      this._state = "errored";
      throw new Error(`${this.id} init failed`);
    }
    this._state = "initializing";
  }

  async start(_surface: RenderSurface): Promise<void> {
    this.callCounts.start++;
    await this._delay(this._opts.startDelayMs);
    if (this._opts.startFail) {
      this._state = "errored";
      throw new Error(`${this.id} start failed`);
    }
    this._state = "running";
  }

  async stop(): Promise<void> {
    this.callCounts.stop++;
    await this._delay(this._opts.stopDelayMs);
    if (this._opts.stopFail) {
      throw new Error(`${this.id} stop failed`);
    }
    this._state = "stopped";
  }

  bindStream(ptyId: string, stream: ReadableStream<Uint8Array>): void {
    this.callCounts.bindStream++;
    this.boundStreams.set(ptyId, stream);
  }

  unbindStream(ptyId: string): void {
    this.callCounts.unbindStream++;
    this.boundStreams.delete(ptyId);
  }

  handleInput(ptyId: string, data: Uint8Array): void {
    this.callCounts.handleInput++;
    this.receivedInput.push({ ptyId, data });
  }

  resize(ptyId: string, cols: number, rows: number): void {
    this.resizeCalls.push({ ptyId, cols, rows });
  }

  queryCapabilities(): RendererCapabilities {
    return { ...DEFAULT_CAPS, ...this._opts.capabilities };
  }

  getState(): RendererState {
    return this._state;
  }

  onCrash(handler: (error: Error) => void): void {
    this._crashHandler = handler;
  }

  /** Simulate a crash (for testing). */
  simulateCrash(error: Error): void {
    this._state = "errored";
    this._crashHandler?.(error);
  }

  /** Reset internal tracking state. */
  reset(): void {
    this._state = "uninitialized";
    this.boundStreams.clear();
    this.receivedInput.length = 0;
    this.resizeCalls.length = 0;
    this.callCounts.init = 0;
    this.callCounts.start = 0;
    this.callCounts.stop = 0;
    this.callCounts.bindStream = 0;
    this.callCounts.unbindStream = 0;
    this.callCounts.handleInput = 0;
    this._initCallCount = 0;
  }
}

// ---------------------------------------------------------------------------
// Concrete mock adapters
// ---------------------------------------------------------------------------

export class MockGhosttyAdapter extends BaseMockAdapter {
  constructor(opts: MockAdapterOptions = {}) {
    super("ghostty", "1.0.0", opts);
  }
}

export class MockRioAdapter extends BaseMockAdapter {
  constructor(opts: MockAdapterOptions = {}) {
    super("rio", "0.9.0", {
      capabilities: {
        gpuAccelerated: true,
        colorDepth: 24,
        ligatureSupport: false,
        sixelSupport: true,
        ...opts.capabilities,
      },
      ...opts,
    });
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export const TEST_SURFACE: RenderSurface = {
  windowId: "win-1",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};

export const TEST_CONFIG: RendererConfig = {
  gpuAcceleration: true,
  colorDepth: 24,
  maxDimensions: { cols: 200, rows: 50 },
};

/** Create a readable stream that emits the given chunks then closes. */
export function createMockPtyStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]!);
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/** Create a readable stream that stays open (never closes). */
export function createOpenPtyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    // Intentionally never closes
    start() {},
  });
}

/** Create a Uint8Array filled with a pattern for easy identification. */
export function createTestData(size: number, fillByte: number = 0xaa): Uint8Array {
  const data = new Uint8Array(size);
  data.fill(fillByte);
  return data;
}
