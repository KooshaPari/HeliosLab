/**
 * Webflow API Client
 *
 * Wrapper around Webflow's Data API v2 for:
 * - Sites management
 * - Asset uploads
 * - Custom code injection
 * - CMS operations
 */

import type { PluginAPI } from '../../../src/main/plugins/types';
import type { StorageManager, WebflowAuth, SiteInfo } from '../storage/manager';

const API_BASE = 'https://api.webflow.com/v2';

export interface WebflowSite {
  id: string;
  workspaceId: string;
  displayName: string;
  shortName: string;
  previewUrl?: string;
  timeZone?: string;
  createdOn?: string;
  lastUpdated?: string;
  lastPublished?: string;
}

export interface WebflowPage {
  id: string;
  siteId: string;
  title: string;
  slug: string;
  parentId?: string;
  collectionId?: string;
  createdOn?: string;
  lastUpdated?: string;
  archived: boolean;
  draft: boolean;
}

export interface WebflowAsset {
  id: string;
  contentType: string;
  size: number;
  siteId: string;
  hostedUrl: string;
  originalFileName: string;
  displayName: string;
  createdOn: string;
  lastUpdated: string;
}

export interface CustomCodeBlock {
  id: string;
  location: 'header' | 'footer';
  type: 'inline' | 'external';
  value: string;
}

export class WebflowClient {
  private storage: StorageManager;
  private api: PluginAPI;

  constructor(storage: StorageManager, api: PluginAPI) {
    this.storage = storage;
    this.api = api;
  }

  /**
   * Check if we have valid authentication
   */
  async isAuthenticated(): Promise<boolean> {
    const auth = await this.storage.getAuth();
    if (!auth) return false;

    // Check if token is expired
    if (auth.expiresAt && auth.expiresAt < Date.now()) {
      // TODO: Implement token refresh
      return false;
    }

    return true;
  }

  /**
   * Get current auth token
   */
  private async getToken(): Promise<string> {
    const auth = await this.storage.getAuth();
    if (!auth) {
      throw new Error('Not authenticated. Run "wf auth" to connect your Webflow account.');
    }
    return auth.accessToken;
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getToken();
    const url = `${API_BASE}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Webflow API error (${response.status}): ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  // ============================================================================
  // Sites
  // ============================================================================

  /**
   * List all sites accessible with the current token
   */
  async listSites(): Promise<WebflowSite[]> {
    const response = await this.request<{ sites: WebflowSite[] }>('GET', '/sites');
    return response.sites;
  }

  /**
   * Get a specific site by ID
   */
  async getSite(siteId: string): Promise<WebflowSite> {
    return this.request<WebflowSite>('GET', `/sites/${siteId}`);
  }

  /**
   * Publish a site
   */
  async publishSite(siteId: string, domains?: string[]): Promise<void> {
    await this.request('POST', `/sites/${siteId}/publish`, { domains });
  }

  // ============================================================================
  // Pages
  // ============================================================================

  /**
   * List all pages for a site
   */
  async listPages(siteId: string): Promise<WebflowPage[]> {
    const response = await this.request<{ pages: WebflowPage[] }>(
      'GET',
      `/sites/${siteId}/pages`
    );
    return response.pages;
  }

  /**
   * Get a specific page
   */
  async getPage(pageId: string): Promise<WebflowPage> {
    return this.request<WebflowPage>('GET', `/pages/${pageId}`);
  }

  // ============================================================================
  // Assets
  // ============================================================================

  /**
   * List all assets for a site
   */
  async listAssets(siteId: string): Promise<WebflowAsset[]> {
    const response = await this.request<{ assets: WebflowAsset[] }>(
      'GET',
      `/sites/${siteId}/assets`
    );
    return response.assets;
  }

  /**
   * Create an asset upload URL
   * Returns a presigned URL for uploading the file
   */
  async createAssetUploadUrl(
    siteId: string,
    fileName: string,
    fileHash: string
  ): Promise<{ uploadUrl: string; uploadDetails: Record<string, string> }> {
    return this.request('POST', `/sites/${siteId}/assets`, {
      fileName,
      fileHash,
    });
  }

  /**
   * Upload an asset to Webflow
   * This is a two-step process:
   * 1. Get a presigned upload URL
   * 2. Upload the file to that URL
   */
  async uploadAsset(
    siteId: string,
    filePath: string,
    fileContent: Uint8Array,
    fileName: string
  ): Promise<WebflowAsset> {
    // Calculate file hash (MD5 base64)
    const buffer = fileContent.buffer as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('MD5', buffer);
    const hashArray = new Uint8Array(hashBuffer);
    const fileHash = btoa(String.fromCharCode(...hashArray));

    // Get upload URL
    const { uploadUrl, uploadDetails } = await this.createAssetUploadUrl(
      siteId,
      fileName,
      fileHash
    );

    // Create form data for upload
    const formData = new FormData();
    for (const [key, value] of Object.entries(uploadDetails)) {
      formData.append(key, value);
    }
    formData.append('file', new Blob([buffer]), fileName);

    // Upload to S3
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Asset upload failed: ${uploadResponse.statusText}`);
    }

    // The asset should now be available - fetch the updated list
    const assets = await this.listAssets(siteId);
    const uploadedAsset = assets.find((a) => a.originalFileName === fileName);
    if (!uploadedAsset) {
      throw new Error('Asset upload succeeded but asset not found in list');
    }

    return uploadedAsset;
  }

  // ============================================================================
  // Custom Code
  // ============================================================================

  /**
   * Get custom code for a site
   */
  async getSiteCustomCode(siteId: string): Promise<{
    headCode?: string;
    footerCode?: string;
  }> {
    return this.request('GET', `/sites/${siteId}/custom_code`);
  }

  /**
   * Update custom code for a site
   */
  async updateSiteCustomCode(
    siteId: string,
    code: { headCode?: string; footerCode?: string }
  ): Promise<void> {
    await this.request('PUT', `/sites/${siteId}/custom_code`, code);
  }

  /**
   * Get custom code for a page
   */
  async getPageCustomCode(pageId: string): Promise<{
    headCode?: string;
    footerCode?: string;
  }> {
    return this.request('GET', `/pages/${pageId}/custom_code`);
  }

  /**
   * Update custom code for a page
   */
  async updatePageCustomCode(
    pageId: string,
    code: { headCode?: string; footerCode?: string }
  ): Promise<void> {
    await this.request('PUT', `/pages/${pageId}/custom_code`, code);
  }

  // ============================================================================
  // Scripts (registered scripts for site)
  // ============================================================================

  /**
   * List registered scripts for a site
   */
  async listScripts(siteId: string): Promise<Array<{
    id: string;
    displayName: string;
    hostedLocation: string;
    integrityHash?: string;
    canCopy: boolean;
    version: string;
  }>> {
    const response = await this.request<{ registeredScripts: Array<{
      id: string;
      displayName: string;
      hostedLocation: string;
      integrityHash?: string;
      canCopy: boolean;
      version: string;
    }> }>('GET', `/sites/${siteId}/registered_scripts`);
    return response.registeredScripts;
  }

  /**
   * Register a script for a site
   */
  async registerScript(
    siteId: string,
    script: {
      displayName: string;
      hostedLocation: string;
      integrityHash?: string;
      version: string;
    }
  ): Promise<{ id: string }> {
    return this.request('POST', `/sites/${siteId}/registered_scripts`, script);
  }

  // ============================================================================
  // Helpers for discovering projects
  // ============================================================================

  /**
   * Sync sites from API to local storage
   */
  async syncSitesToStorage(): Promise<SiteInfo[]> {
    const sites = await this.listSites();
    const siteInfos: SiteInfo[] = [];

    for (const site of sites) {
      const siteInfo: SiteInfo = {
        id: site.id,
        shortName: site.shortName,
        displayName: site.displayName,
        previewUrl: site.previewUrl,
        lastAccessed: Date.now(),
      };
      await this.storage.setSite(siteInfo);
      siteInfos.push(siteInfo);
    }

    return siteInfos;
  }
}
