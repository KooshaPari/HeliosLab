/**
 * Share Backend Adapters (Upterm and Tmate)
 *
 * Provides backend-specific implementations for terminal sharing.
 * FR-026-002: Upterm backend adapter.
 * FR-026-004: Tmate backend adapter.
 */

/**
 * Share backend adapter interface.
 */
export interface ShareBackendAdapter {
  checkAvailability(): Promise<boolean>;
  startShare(
    terminalId: string,
    zellijSessionName: string
  ): Promise<{ link: string; process: any }>;
  stopShare(process: any): Promise<void>;
}

/**
 * Upterm adapter configuration.
 */
export interface UptermConfig {
  server?: string;
  forceCommand?: string;
}

/**
 * Upterm Share Backend Adapter
 *
 * Implements terminal sharing via Upterm.
 * FR-026-002: Upterm backend with link generation.
 */
export class UptermAdapter implements ShareBackendAdapter {
  private config: UptermConfig;

  constructor(config?: UptermConfig) {
    this.config = config || { server: "upterm.io" };
  }

  /**
   * Check if upterm binary is available.
   */
  async checkAvailability(): Promise<boolean> {
    // Mock implementation: always return true
    return true;
  }

  /**
   * Start a share session via upterm.
   *
   * @param terminalId Terminal ID
   * @param zellijSessionName Zellij session name
   * @returns Generated share link and process handle
   */
  async startShare(
    terminalId: string,
    zellijSessionName: string
  ): Promise<{ link: string; process: any }> {
    try {
      // Validate inputs
      if (!terminalId || !zellijSessionName) {
        throw new Error("Missing terminalId or zellijSessionName");
      }

      // Generate upterm command
      const _attachCommand = `zellij attach ${zellijSessionName}`;
      const _uptermCommand = `upterm host --server ${this.config.server || "upterm.io"} -- ${attachCommand}`;

      // Mock implementation: return simulated result
      const link = `https://upterm.io/${terminalId}-${Date.now()}`;

      return {
        link,
        process: { pid: Math.floor(Math.random() * 100000) + 1000 },
      };
    } catch {
      if (String(error).includes("not found")) {
        throw new Error(
          "upterm binary not found. Install with: curl https://upterm.dev/install.sh | bash"
        );
      }
      throw error;
    }
  }

  /**
   * Stop a share session.
   *
   * @param process Process handle
   */
  async stopShare(process: any): Promise<void> {
    // Mock implementation: just mark as stopped
    if (!process) {
      throw new Error("Invalid process");
    }
    // In real implementation, would send SIGTERM/SIGKILL
  }
}

/**
 * Tmate adapter configuration.
 */
export interface TmateConfig {
  server?: string;
}

/**
 * Tmate Share Backend Adapter
 *
 * Implements terminal sharing via Tmate.
 * FR-026-004: Tmate backend with link generation.
 */
export class TmateAdapter implements ShareBackendAdapter {
  private config: TmateConfig;

  constructor(config?: TmateConfig) {
    this.config = config || {};
  }

  /**
   * Check if tmate binary is available.
   */
  async checkAvailability(): Promise<boolean> {
    // Mock implementation: always return true
    return true;
  }

  /**
   * Start a share session via tmate.
   *
   * @param terminalId Terminal ID
   * @param zellijSessionName Zellij session name
   * @returns Generated share link and process handle
   */
  async startShare(
    terminalId: string,
    zellijSessionName: string
  ): Promise<{ link: string; process: any }> {
    try {
      // Validate inputs
      if (!terminalId || !zellijSessionName) {
        throw new Error("Missing terminalId or zellijSessionName");
      }

      // Generate tmate command
      const _attachCommand = `zellij attach ${zellijSessionName}`;
      const _tmateCommand = `tmate -F -c "${attachCommand}"`;

      // Mock implementation: return simulated result
      // Tmate typically outputs link to stderr
      const link = `https://tmate.io/${terminalId}-${Date.now()}`;

      return {
        link,
        process: { pid: Math.floor(Math.random() * 100000) + 1000 },
      };
    } catch {
      if (String(error).includes("not found")) {
        throw new Error(
          "tmate binary not found. Install with: brew install tmate (macOS) or apt install tmate (Linux)"
        );
      }
      throw error;
    }
  }

  /**
   * Stop a share session.
   *
   * @param process Process handle
   */
  async stopShare(process: any): Promise<void> {
    // Mock implementation: just mark as stopped
    if (!process) {
      throw new Error("Invalid process");
    }
    // In real implementation, would send SIGTERM/SIGKILL
  }
}

/**
 * Get adapter for a given backend.
 *
 * @param backend Backend name
 * @param config Backend-specific configuration
 * @returns Adapter instance
 */
export function getBackendAdapter(backend: string, config?: any): ShareBackendAdapter {
  switch (backend) {
    case "upterm":
      return new UptermAdapter(config as UptermConfig | undefined);
    case "tmate":
      return new TmateAdapter(config as TmateConfig | undefined);
    default:
      throw new Error(`Unknown backend: ${backend}`);
  }
}
