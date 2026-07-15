/**
 * Binding Persistence Adapter
 *
 * Implements durable persistence for terminal bindings using file-backed JSON storage.
 * Bindings are saved asynchronously with debouncing to avoid write storms.
 * On recovery, persisted bindings are re-validated against current state.
 */

import { promises as fs } from "fs";
import { createHash } from "crypto";
import { homedir } from "os";
import { dirname, join } from "path";
import type { TerminalBinding } from "./binding_triple.js";

export interface PersistenceStore {
  save(bindings: TerminalBinding[]): Promise<void>;
  load(): Promise<TerminalBinding[]>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}

interface PersistenceData {
  version: number;
  timestamp: string;
  bindings: TerminalBinding[];
  checksum: string;
}

/**
 * File-backed JSON persistence for terminal bindings.
 *
 * Strategy:
 * - Async writes with debouncing (500ms) to avoid write storms
 * - In-memory registry is primary; persistence is for recovery only
 * - Immediate flush on explicit call (e.g., before shutdown)
 * - Checksum validation on load for corruption detection
 */
export class JsonFilePersistence implements PersistenceStore {
  private storePath: string;
  private writeDebounceMs = 500;
  private writeTimeoutId: NodeJS.Timeout | null = null;
  private pendingBindings: TerminalBinding[] | null = null;
  private readonly version = 1;

  constructor(storePath?: string) {
    if (storePath) {
      this.storePath = storePath;
    } else {
      // Default: ~/.helios/data/binding_registry.json
      const dataDir = join(homedir(), ".helios", "data");
      this.storePath = join(dataDir, "binding_registry.json");
    }
  }

  /**
   * Schedule an async write with debouncing.
   *
   * Subsequent calls within the debounce window replace the pending write.
   */
  async save(bindings: TerminalBinding[]): Promise<void> {
    this.pendingBindings = bindings;

    // Clear existing timeout
    if (this.writeTimeoutId) {
      clearTimeout(this.writeTimeoutId);
    }

    // Schedule new write
    this.writeTimeoutId = setTimeout(async () => {
      try {
        await this.doWrite(bindings);
        this.writeTimeoutId = null;
        this.pendingBindings = null;
      } catch (error) {
        console.error("Failed to persist bindings:", error);
      }
    }, this.writeDebounceMs);
  }

  /**
   * Load persisted bindings from disk.
   *
   * Returns empty array if file doesn't exist or is corrupt.
   * Validates checksum; discards if corrupt with warning.
   */
  async load(): Promise<TerminalBinding[]> {
    try {
      const content = await fs.readFile(this.storePath, "utf-8");
      const data: PersistenceData = JSON.parse(content);

      // Verify structure
      if (!data.bindings || !Array.isArray(data.bindings)) {
        console.warn("Invalid persistence format: missing or invalid bindings array");
        return [];
      }

      // Verify checksum
      const expectedChecksum = this.computeChecksum(data.bindings, data.timestamp);
      if (data.checksum !== expectedChecksum) {
        console.warn("Persistence file is corrupt (checksum mismatch); starting fresh");
        return [];
      }

      return data.bindings;
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        // File doesn't exist; expected on first run
        return [];
      }
      console.warn("Failed to load persisted bindings:", error);
      return [];
    }
  }

  /**
   * Immediately flush pending writes to disk.
   *
   * Called during shutdown or explicit save requests.
   */
  async flush(): Promise<void> {
    if (this.writeTimeoutId) {
      clearTimeout(this.writeTimeoutId);
      this.writeTimeoutId = null;
    }

    if (this.pendingBindings) {
      await this.doWrite(this.pendingBindings);
      this.pendingBindings = null;
    }
  }

  /**
   * Clear all persisted data.
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.storePath);
    } catch (error) {
      if ((error as any).code !== "ENOENT") {
        console.error("Failed to clear persistence:", error);
      }
    }
  }

  /**
   * Perform the actual write operation.
   */
  private async doWrite(bindings: TerminalBinding[]): Promise<void> {
    const timestamp = new Date().toISOString();
    const checksum = this.computeChecksum(bindings, timestamp);

    const data: PersistenceData = {
      version: this.version,
      timestamp,
      bindings,
      checksum,
    };

    // Ensure directory exists
    await fs.mkdir(dirname(this.storePath), { recursive: true });

    // Write atomically using temp file
    const tempPath = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.rename(tempPath, this.storePath);
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  /**
   * Compute checksum for persistence data integrity.
   */
  private computeChecksum(bindings: TerminalBinding[], timestamp: string): string {
    const data = JSON.stringify({ bindings, timestamp });
    return createHash("sha256").update(data).digest("hex");
  }
}

/**
 * In-memory persistence adapter for testing.
 *
 * Does not persist to disk; useful for unit tests and scenarios
 * where persistence is not needed.
 */
export class InMemoryPersistence implements PersistenceStore {
  private data: TerminalBinding[] = [];

  async save(bindings: TerminalBinding[]): Promise<void> {
    this.data = [...bindings];
  }

  async load(): Promise<TerminalBinding[]> {
    return [...this.data];
  }

  async clear(): Promise<void> {
    this.data = [];
  }

  async flush(): Promise<void> {
    // No-op for in-memory
  }
}
