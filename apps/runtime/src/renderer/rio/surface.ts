/**
 * Rio surface binding.
 *
 * Connects the rio renderer to an ElectroBun window region and manages
 * the render surface lifecycle.
 */

import type { RenderSurface } from "../adapter.js";

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export class RioSurface {
  private _surface: RenderSurface | undefined;
  private _pid: number | undefined;
  private _bound = false;

  /**
   * Bind rio to the given window surface.
   */
  bind(surface: RenderSurface, pid: number): void {
    this._surface = surface;
    this._pid = pid;
    this._bound = true;
  }

  /**
   * Unbind and release the surface.
   */
  unbind(): void {
    this._surface = undefined;
    this._pid = undefined;
    this._bound = false;
  }

  /**
   * Update the render region bounds.
   */
  resize(bounds: { x: number; y: number; width: number; height: number }): void {
    if (!this._surface) return;
    // Handle zero-size surface (e.g. minimized window).
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this._surface = {
      ...this._surface,
      bounds,
    };
  }

  isBound(): boolean {
    return this._bound;
  }

  getSurface(): RenderSurface | undefined {
    return this._surface;
  }

  getPid(): number | undefined {
    return this._pid;
  }
}
