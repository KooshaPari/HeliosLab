/**
 * Abstract renderer adapter interface.
 *
 * All renderer backends (ghostty, rio, etc.) must implement this contract.
 * This file contains only interface and type definitions — no concrete
 * implementation.
 */

import type { RendererCapabilities } from "./capabilities.js";

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface RendererConfig {
  gpuAcceleration: boolean;
  colorDepth: number;
  maxDimensions: { cols: number; rows: number };
}

export interface RenderSurface {
  windowId: string;
  bounds: { x: number; y: number; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Renderer state
// ---------------------------------------------------------------------------

export type RendererState =
  | "uninitialized"
  | "initializing"
  | "running"
  | "switching"
  | "stopping"
  | "stopped"
  | "errored";

// ---------------------------------------------------------------------------
// Abstract adapter interface
// ---------------------------------------------------------------------------

export interface RendererAdapter {
  readonly id: string;
  readonly version: string;

  init(config: RendererConfig): Promise<void>;
  start(surface: RenderSurface): Promise<void>;
  stop(): Promise<void>;

  bindStream(ptyId: string, stream: ReadableStream<Uint8Array>): void;
  unbindStream(ptyId: string): void;
  handleInput(ptyId: string, data: Uint8Array): void;
  resize(ptyId: string, cols: number, rows: number): void;

  queryCapabilities(): RendererCapabilities;
  getState(): RendererState;
  onCrash(handler: (error: Error) => void): void;
}
