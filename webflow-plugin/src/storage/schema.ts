/**
 * Storage Schema Types
 *
 * Defines the data structures stored by the Webflow plugin
 */

// Re-export types from manager for external use
export type {
  WebflowAuth,
  SiteInfo,
  AssetInfo,
  AssetConnection,
  PluginStorage,
} from './manager';

/**
 * Project types detected by scanning filesystem
 */
export interface DiscoveredProject {
  type: 'devlink' | 'code-components' | 'cloud';
  path: string;
  siteId?: string;
  siteName?: string;
  lastModified: number;
}

/**
 * DevLink project configuration (.webflowrc.json)
 */
export interface DevLinkConfig {
  siteId: string;
  siteName?: string;
  componentsPath?: string;
  host?: string;
  authMethod?: 'oauth' | 'token';
}

/**
 * Code Components library configuration (webflow.json)
 */
export interface CodeComponentsConfig {
  name: string;
  version: string;
  components: string[];
  workspaceId?: string;
}

/**
 * Webflow Cloud project configuration (.colab.json with type: webflow-cloud)
 */
export interface CloudProjectConfig {
  type: 'webflow-cloud';
  name: string;
  siteId: string;
  siteName?: string;
  framework: 'astro' | 'nextjs';
  mountPath: string;
  devlinkEnabled?: boolean;
}

/**
 * Deployment record
 */
export interface Deployment {
  id: string;
  siteId: string;
  commitHash?: string;
  commitMessage?: string;
  deployedAt: number;
  status: 'pending' | 'building' | 'deploying' | 'live' | 'failed';
  duration?: number;
  url?: string;
}

/**
 * Sync status for DevLink components
 */
export interface ComponentSyncStatus {
  name: string;
  localVersion?: string;
  remoteVersion?: string;
  status: 'synced' | 'local-newer' | 'remote-newer' | 'conflict' | 'local-only' | 'remote-only';
  lastSynced?: number;
}
