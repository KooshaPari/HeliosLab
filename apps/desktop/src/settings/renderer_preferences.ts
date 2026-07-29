/**
 * Renderer Preferences Module
 * Persists renderer settings across sessions
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";

export interface RendererPreferences {
  activeRenderer: string;
  hotSwapEnabled: boolean;
}

const DEFAULT_PREFERENCES: RendererPreferences = {
  activeRenderer: "ghostty",
  hotSwapEnabled: true,
};

export class RendererPreferencesManager {
  private preferencesPath: string;
  private preferences: RendererPreferences = { ...DEFAULT_PREFERENCES };
  private isDirty: boolean = false;

  constructor(preferencesPath?: string) {
    if (preferencesPath) {
      this.preferencesPath = preferencesPath;
    } else {
      const heliosDataDir = resolve(homedir(), ".helios", "data");
      this.preferencesPath = resolve(heliosDataDir, "renderer_preferences.json");
    }
  }

  load(): RendererPreferences {
    const startTime = performance.now();

    try {
      if (this.doesFileExist()) {
        const content = readFileSync(this.preferencesPath, "utf-8");
        const loaded = JSON.parse(content);

        // Validate loaded preferences
        if (this.isValidPreferences(loaded)) {
          this.preferences = loaded;
          const loadTime = performance.now() - startTime;
          console.log(`Renderer preferences loaded in ${loadTime.toFixed(2)}ms`);
          return { ...this.preferences };
        } else {
          console.warn("Invalid preferences file, using defaults");
          return { ...DEFAULT_PREFERENCES };
        }
      }
    } catch (error) {
      console.warn("Failed to load renderer preferences, using defaults", error);
    }

    this.preferences = { ...DEFAULT_PREFERENCES };
    return { ...this.preferences };
  }

  save(preferences: Partial<RendererPreferences>): void {
    try {
      Object.assign(this.preferences, preferences);
      this.ensureDirectoryExists();

      const content = JSON.stringify(this.preferences, null, 2);
      writeFileSync(this.preferencesPath, content, "utf-8");

      this.isDirty = false;
      console.log("Renderer preferences saved");
    } catch (error) {
      console.error("Failed to save renderer preferences", error);
    }
  }

  getActiveRenderer(): string {
    return this.preferences.activeRenderer;
  }

  setActiveRenderer(rendererId: string): void {
    if (rendererId !== this.preferences.activeRenderer) {
      this.preferences.activeRenderer = rendererId;
      this.isDirty = true;
    }
  }

  isHotSwapEnabled(): boolean {
    return this.preferences.hotSwapEnabled;
  }

  setHotSwapEnabled(enabled: boolean): void {
    if (enabled !== this.preferences.hotSwapEnabled) {
      this.preferences.hotSwapEnabled = enabled;
      this.isDirty = true;
    }
  }

  markDirty(): void {
    this.isDirty = true;
  }

  isDirtyCheck(): boolean {
    return this.isDirty;
  }

  getPreferences(): RendererPreferences {
    return { ...this.preferences };
  }

  private doesFileExist(): boolean {
    try {
      readFileSync(this.preferencesPath);
      return true;
    } catch {
      return false;
    }
  }

  private ensureDirectoryExists(): void {
    const dir = dirname(this.preferencesPath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      console.error("Failed to create preferences directory", error);
    }
  }

  private isValidPreferences(obj: any): boolean {
    return (
      obj &&
      typeof obj === "object" &&
      typeof obj.activeRenderer === "string" &&
      typeof obj.hotSwapEnabled === "boolean"
    );
  }
}

let _instance: RendererPreferencesManager | null = null;

export function getRendererPreferencesManager(): RendererPreferencesManager {
  if (!_instance) {
    _instance = new RendererPreferencesManager();
  }
  return _instance;
}

export function createRendererPreferencesManager(path?: string): RendererPreferencesManager {
  return new RendererPreferencesManager(path);
}
