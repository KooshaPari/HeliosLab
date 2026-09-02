/**
 * Configurable mock renderer adapters for testing.
 *
 * MockGhosttyAdapter and MockRioAdapter implement RendererAdapter with
 * configurable success/failure behavior and instrumentation.
 */

import type {
  RendererAdapter,
  RendererConfig,
  RenderSurface,
  RendererState,
  RendererCapabilities,
} from "../../src/renderer/index.js";

export interface MockAdapterOptions {
  initFail?: boolean;
  startFail?: boolean;
  stopFail?: boolean;
  initDelay?: number;
  startDelay?: number;
  stopDelay?: number;
  /** Make init fail only on Nth call (1-indexed). */
  initFailOnCall?: number;
  /** Make start fail only on Nth call (1-indexed). */
  startFailOnCall?: number;
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class MockRendererAdapter implements RendererAdapter {
  readonly id: string;
  readonly version: string;
  private _state: RendererState = "uninitialized";
  private _opts: MockAdapterOptions;
  private _crashHandler?: (error: Error) => void;
  private _caps: RendererCapabilities;

  // Instrumentation
  boundStreams = new Map<string, ReadableStream<Uint8Array>>();
  unboundPtyIds: string[] = [];
  receivedInput: Array<{ ptyId: string; data: Uint8Array }> = [];
  resizeEvents: Array<{ ptyId: string; cols: number; rows: number }> = [];
  initCallCount = 0;
  startCallCount = 0;
  stopCallCount = 0;

  constructor(
    id: string,
    version: string = "1.0.0",
    opts: MockAdapterOptions = {},
    caps?: Partial<RendererCapabilities>
  ) {
    this.id = id;
    this.version = version;
    this._opts = opts;
    this._caps = { ...DEFAULT_CAPS, ...caps };
  }

  async init(_config: RendererConfig): Promise<void> {
    this.initCallCount++;
    if (this._opts.initDelay) await delay(this._opts.initDelay);
    if (this._opts.initFail) throw new Error(`${this.id} init failed`);
    if (this._opts.initFailOnCall === this.initCallCount)
      throw new Error(`${this.id} init failed on call ${this.initCallCount}`);
    this._state = "running";
  }

  async start(_surface: RenderSurface): Promise<void> {
    this.startCallCount++;
    if (this._opts.startDelay) await delay(this._opts.startDelay);
    if (this._opts.startFail) throw new Error(`${this.id} start failed`);
    if (this._opts.startFailOnCall === this.startCallCount)
      throw new Error(`${this.id} start failed on call ${this.startCallCount}`);
    this._state = "running";
  }

  async stop(): Promise<void> {
    this.stopCallCount++;
    if (this._opts.stopDelay) await delay(this._opts.stopDelay);
    if (this._opts.stopFail) throw new Error(`${this.id} stop failed`);
    this._state = "stopped";
  }

  bindStream(ptyId: string, stream: ReadableStream<Uint8Array>): void {
    this.boundStreams.set(ptyId, stream);
  }

  unbindStream(ptyId: string): void {
    this.boundStreams.delete(ptyId);
    this.unboundPtyIds.push(ptyId);
  }

  handleInput(ptyId: string, data: Uint8Array): void {
    this.receivedInput.push({ ptyId, data });
  }

  resize(ptyId: string, cols: number, rows: number): void {
    this.resizeEvents.push({ ptyId, cols, rows });
  }

  queryCapabilities(): RendererCapabilities {
    return this._caps;
  }

  getState(): RendererState {
    return this._state;
  }

  onCrash(handler: (error: Error) => void): void {
    this._crashHandler = handler;
  }

  // Test helpers
  simulateCrash(error: Error): void {
    this._state = "errored";
    this._crashHandler?.(error);
  }

  setOptions(opts: Partial<MockAdapterOptions>): void {
    this._opts = { ...this._opts, ...opts };
  }

  reset(): void {
    this._state = "uninitialized";
    this.boundStreams.clear();
    this.unboundPtyIds = [];
    this.receivedInput = [];
    this.resizeEvents = [];
    this.initCallCount = 0;
    this.startCallCount = 0;
    this.stopCallCount = 0;
  }
}

export class MockGhosttyAdapter extends MockRendererAdapter {
  constructor(opts: MockAdapterOptions = {}, caps?: Partial<RendererCapabilities>) {
    super("ghostty", "0.15.0", opts, {
      gpuAccelerated: true,
      sixelSupport: true,
      ...caps,
    });
  }
}

export class MockRioAdapter extends MockRendererAdapter {
  constructor(opts: MockAdapterOptions = {}, caps?: Partial<RendererCapabilities>) {
    super("rio", "0.1.0", opts, {
      gpuAccelerated: true,
      sixelSupport: false,
      ...caps,
    });
  }
}

export const TEST_SURFACE: RenderSurface = {
  windowId: "win-test",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};

export const TEST_CONFIG: RendererConfig = {
  gpuAcceleration: true,
  colorDepth: 24,
  maxDimensions: { cols: 200, rows: 50 },
};
