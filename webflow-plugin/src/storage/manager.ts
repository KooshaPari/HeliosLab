/**
 * Storage Manager for Webflow Plugin
 *
 * Handles persistent storage for:
 * - OAuth tokens
 * - Site registry (known sites and their metadata)
 * - Asset metadata (CDN URLs, connections)
 * - Plugin settings
 */

import type { PluginAPI } from '../../../src/main/plugins/types';

export interface WebflowAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userId?: string;
  email?: string;
}

export interface SiteInfo {
  id: string;
  shortName: string;
  displayName: string;
  previewUrl?: string;
  lastAccessed: number;
}

export interface AssetInfo {
  localPath: string;
  cdnUrl: string;
  hash: string;
  lastUploaded: number;
  connections: AssetConnection[];
}

export interface AssetConnection {
  type: 'site' | 'page' | 'element';
  location: 'head' | 'body';
  siteId?: string;
  pageSlug?: string;
  elementId?: string;
  loadStrategy?: 'sync' | 'async' | 'defer';
}

export interface PluginStorage {
  version: number;
  auth?: WebflowAuth;
  sites: Record<string, SiteInfo>;
  assets: Record<string, AssetInfo>;
}

const STORAGE_VERSION = 1;

export class StorageManager {
  private api: PluginAPI;
  private data: PluginStorage;

  constructor(api: PluginAPI) {
    this.api = api;
    this.data = {
      version: STORAGE_VERSION,
      sites: {},
      assets: {},
    };
  }

  /**
   * Initialize storage by loading persisted data
   */
  async initialize(): Promise<void> {
    try {
      const stored = this.api.settings.get<string>('_storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.version === STORAGE_VERSION) {
          this.data = parsed;
        } else {
          // Handle migration if needed
          this.api.log.warn(`Storage version mismatch: ${parsed.version} vs ${STORAGE_VERSION}`);
        }
      }
    } catch (e) {
      this.api.log.error('Failed to load storage:', e);
    }
  }

  /**
   * Persist storage to disk
   */
  private async save(): Promise<void> {
    try {
      this.api.settings.set('_storage', JSON.stringify(this.data));
    } catch (e) {
      this.api.log.error('Failed to save storage:', e);
    }
  }

  // ============================================================================
  // Auth
  // ============================================================================

  async getAuth(): Promise<WebflowAuth | undefined> {
    return this.data.auth;
  }

  async setAuth(auth: WebflowAuth): Promise<void> {
    this.data.auth = auth;
    await this.save();
  }

  async clearAuth(): Promise<void> {
    delete this.data.auth;
    await this.save();
  }

  // ============================================================================
  // Sites
  // ============================================================================

  async getSites(): Promise<SiteInfo[]> {
    return Object.values(this.data.sites);
  }

  async getSite(siteId: string): Promise<SiteInfo | undefined> {
    return this.data.sites[siteId];
  }

  async setSite(site: SiteInfo): Promise<void> {
    this.data.sites[site.id] = site;
    await this.save();
  }

  async removeSite(siteId: string): Promise<void> {
    delete this.data.sites[siteId];
    await this.save();
  }

  async updateSiteLastAccessed(siteId: string): Promise<void> {
    if (this.data.sites[siteId]) {
      this.data.sites[siteId].lastAccessed = Date.now();
      await this.save();
    }
  }

  // ============================================================================
  // Assets
  // ============================================================================

  async getAssets(): Promise<AssetInfo[]> {
    return Object.values(this.data.assets);
  }

  async getAsset(localPath: string): Promise<AssetInfo | undefined> {
    return this.data.assets[localPath];
  }

  async setAsset(asset: AssetInfo): Promise<void> {
    this.data.assets[asset.localPath] = asset;
    await this.save();
  }

  async removeAsset(localPath: string): Promise<void> {
    delete this.data.assets[localPath];
    await this.save();
  }

  async getAssetsBySite(siteId: string): Promise<AssetInfo[]> {
    return Object.values(this.data.assets).filter((asset) =>
      asset.connections.some((conn) => conn.siteId === siteId)
    );
  }

  // ============================================================================
  // Discovered Projects (runtime only, not persisted)
  // ============================================================================

  // These would be populated by scanning the filesystem for config files
  // Not persisted since they're discovered dynamically
}
