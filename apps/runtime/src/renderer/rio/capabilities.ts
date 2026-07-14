/**
 * Rio capability detection and reporting.
 *
 * Reports capabilities using the same RendererCapabilities type as ghostty
 * for renderer-agnostic comparison.
 */

import type { RendererCapabilities } from "../capabilities.js";
import type { RendererConfig } from "../adapter.js";

// ---------------------------------------------------------------------------
// Default capabilities for rio
// ---------------------------------------------------------------------------

const DEFAULT_RIO_CAPABILITIES: RendererCapabilities = {
  gpuAccelerated: false,
  colorDepth: 24,
  ligatureSupport: false, // rio does not support ligatures in current version
  maxDimensions: { cols: 500, rows: 200 },
  inputModes: ["raw", "cooked", "application"],
  sixelSupport: false,
  italicSupport: true,
  strikethroughSupport: true,
};

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export class RioCapabilities {
  private _capabilities: RendererCapabilities = { ...DEFAULT_RIO_CAPABILITIES };
  private _detected = false;

  /**
   * Detect capabilities based on config and runtime environment.
   * Results are cached after first detection.
   */
  detect(config: RendererConfig): void {
    this._capabilities = {
      ...DEFAULT_RIO_CAPABILITIES,
      gpuAccelerated: config.gpuAcceleration,
      colorDepth:
        config.colorDepth === 8 || config.colorDepth === 16 || config.colorDepth === 24
          ? config.colorDepth
          : 24,
      maxDimensions: {
        cols: Math.min(config.maxDimensions.cols, 500),
        rows: Math.min(config.maxDimensions.rows, 200),
      },
    };
    this._detected = true;
  }

  /**
   * Return the current capabilities. Returns cached result after detection,
   * or static defaults before detection.
   *
   * Must return in < 50ms (p95).
   */
  get(): RendererCapabilities {
    return { ...this._capabilities };
  }

  isDetected(): boolean {
    return this._detected;
  }
}
