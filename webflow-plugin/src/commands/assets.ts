/**
 * Assets Command Handler
 *
 * Handles uploading assets to Webflow CDN and injecting custom code
 *
 * Commands:
 *   wf assets upload <file>  - Upload a file to Webflow CDN
 *   wf assets sync           - Sync all assets in project
 *   wf assets inject         - Update custom code with asset references
 *   wf assets list           - List uploaded assets
 */

import type { PluginAPI } from '../../../src/main/plugins/types';
import type { WebflowClient } from '../api/client';
import type { StorageManager, AssetConnection } from '../storage/manager';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';

export async function handleAssetsCommand(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  const subcommand = args[0] || 'list';

  switch (subcommand) {
    case 'upload':
      await handleUpload(args.slice(1), write, cwd, client, storage, api);
      break;

    case 'sync':
      await handleSync(write, cwd, client, storage, api);
      break;

    case 'inject':
      await handleInject(args.slice(1), write, cwd, client, storage, api);
      break;

    case 'list':
      await handleList(write, cwd, client, storage);
      break;

    case 'connect':
      await handleConnect(args.slice(1), write, cwd, client, storage, api);
      break;

    case '--help':
    case 'help':
      printHelp(write);
      break;

    default:
      write(`\x1b[31mUnknown assets command: ${subcommand}\x1b[0m\r\n`);
      write('Run "wf assets --help" for available commands.\r\n');
  }
}

async function handleUpload(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  if (args.length === 0) {
    write('\x1b[31mUsage: wf assets upload <file> [--site <site_id>]\x1b[0m\r\n');
    return;
  }

  // Parse arguments
  let filePath = args[0];
  let siteId: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--site' || args[i] === '-s') {
      siteId = args[++i];
    }
  }

  // Resolve file path
  if (!filePath.startsWith('/')) {
    filePath = join(cwd, filePath);
  }

  if (!existsSync(filePath)) {
    write(`\x1b[31mFile not found: ${filePath}\x1b[0m\r\n`);
    return;
  }

  // Get site ID from config if not provided
  if (!siteId) {
    siteId = await getSiteIdFromConfig(cwd);
  }

  if (!siteId) {
    write('\x1b[31mNo site specified.\x1b[0m\r\n');
    write('Use --site <site_id> or run from a directory with .webflowrc.json\r\n');
    return;
  }

  // Check authentication
  if (!await client.isAuthenticated()) {
    write('\x1b[31mNot authenticated.\x1b[0m Run "wf auth" first.\r\n');
    return;
  }

  const fileName = basename(filePath);
  write(`\x1b[36mUploading ${fileName}...\x1b[0m\r\n`);

  try {
    const fileContent = readFileSync(filePath);
    const asset = await client.uploadAsset(
      siteId,
      filePath,
      new Uint8Array(fileContent),
      fileName
    );

    // Store asset info
    await storage.setAsset({
      localPath: filePath,
      cdnUrl: asset.hostedUrl,
      hash: '', // TODO: calculate hash
      lastUploaded: Date.now(),
      connections: [],
    });

    write(`\x1b[32m✓ Uploaded successfully!\x1b[0m\r\n\r\n`);
    write(`CDN URL: ${asset.hostedUrl}\r\n`);
    write(`\r\nTo inject this asset, run:\r\n`);
    write(`  wf assets connect ${fileName} --site-head\r\n`);

    api.log.info(`Asset uploaded: ${fileName} -> ${asset.hostedUrl}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    write(`\x1b[31mUpload failed: ${message}\x1b[0m\r\n`);
    api.log.error('Asset upload failed:', e);
  }
}

async function handleSync(
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  // Look for assets directory
  const assetsDir = join(cwd, 'assets');
  if (!existsSync(assetsDir)) {
    write('\x1b[33mNo assets/ directory found.\x1b[0m\r\n');
    write('Create an assets/ directory with files to sync.\r\n');
    return;
  }

  // Get site ID
  const siteId = await getSiteIdFromConfig(cwd);
  if (!siteId) {
    write('\x1b[31mNo site configured.\x1b[0m Run "wf devlink init" first.\r\n');
    return;
  }

  if (!await client.isAuthenticated()) {
    write('\x1b[31mNot authenticated.\x1b[0m Run "wf auth" first.\r\n');
    return;
  }

  write(`\x1b[36mScanning assets directory...\x1b[0m\r\n\r\n`);

  // Find all uploadable files
  const files = findAssetFiles(assetsDir);

  if (files.length === 0) {
    write('No uploadable files found.\r\n');
    return;
  }

  write(`Found ${files.length} file(s) to sync:\r\n\r\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const relativePath = file.replace(assetsDir + '/', '');
    const fileName = basename(file);

    // Check if already uploaded and unchanged
    const existingAsset = await storage.getAsset(file);
    if (existingAsset) {
      // TODO: Check hash to see if file changed
      write(`  \x1b[90m○ ${relativePath} (already uploaded)\x1b[0m\r\n`);
      skipped++;
      continue;
    }

    try {
      const fileContent = readFileSync(file);
      const asset = await client.uploadAsset(
        siteId,
        file,
        new Uint8Array(fileContent),
        fileName
      );

      await storage.setAsset({
        localPath: file,
        cdnUrl: asset.hostedUrl,
        hash: '',
        lastUploaded: Date.now(),
        connections: [],
      });

      write(`  \x1b[32m✓ ${relativePath}\x1b[0m\r\n`);
      uploaded++;
    } catch (e) {
      write(`  \x1b[31m✗ ${relativePath}\x1b[0m\r\n`);
      failed++;
    }
  }

  write(`\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n`);
  write(`Uploaded: ${uploaded}, Skipped: ${skipped}, Failed: ${failed}\r\n`);

  if (uploaded > 0) {
    api.log.info(`Synced ${uploaded} assets`);
  }
}

async function handleInject(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  const siteId = await getSiteIdFromConfig(cwd);
  if (!siteId) {
    write('\x1b[31mNo site configured.\x1b[0m\r\n');
    return;
  }

  if (!await client.isAuthenticated()) {
    write('\x1b[31mNot authenticated.\x1b[0m Run "wf auth" first.\r\n');
    return;
  }

  write(`\x1b[36mGenerating custom code from asset connections...\x1b[0m\r\n\r\n`);

  // Get all assets for this site
  const assets = await storage.getAssetsBySite(siteId);

  if (assets.length === 0) {
    write('No assets with connections found.\r\n');
    write('Use "wf assets connect" to configure where assets should be injected.\r\n');
    return;
  }

  // Group by connection type
  const siteHead: string[] = [];
  const siteFooter: string[] = [];
  const pageConnections: Map<string, { head: string[]; footer: string[] }> = new Map();

  for (const asset of assets) {
    for (const conn of asset.connections) {
      const tag = generateTag(asset.cdnUrl, conn);

      if (conn.type === 'site') {
        if (conn.location === 'head') {
          siteHead.push(tag);
        } else {
          siteFooter.push(tag);
        }
      } else if (conn.type === 'page' && conn.pageSlug) {
        if (!pageConnections.has(conn.pageSlug)) {
          pageConnections.set(conn.pageSlug, { head: [], footer: [] });
        }
        const page = pageConnections.get(conn.pageSlug)!;
        if (conn.location === 'head') {
          page.head.push(tag);
        } else {
          page.footer.push(tag);
        }
      }
    }
  }

  // Apply site-wide custom code
  if (siteHead.length > 0 || siteFooter.length > 0) {
    write('Site-wide custom code:\r\n');
    if (siteHead.length > 0) {
      write(`  Head: ${siteHead.length} tag(s)\r\n`);
    }
    if (siteFooter.length > 0) {
      write(`  Footer: ${siteFooter.length} tag(s)\r\n`);
    }

    try {
      await client.updateSiteCustomCode(siteId, {
        headCode: siteHead.join('\n'),
        footerCode: siteFooter.join('\n'),
      });
      write('  \x1b[32m✓ Updated site custom code\x1b[0m\r\n');
    } catch (e) {
      write(`  \x1b[31m✗ Failed to update site custom code\x1b[0m\r\n`);
    }
  }

  // Apply page-specific custom code
  if (pageConnections.size > 0) {
    write('\r\nPage-specific custom code:\r\n');

    // We'd need to get page IDs from slugs - this is a simplification
    write('  \x1b[33m⚠ Page-specific injection requires page IDs.\x1b[0m\r\n');
    write('  Use the Webflow Designer for page-specific code.\r\n');
  }

  write('\r\n\x1b[32m✓ Injection complete!\x1b[0m\r\n');
  write('\r\n\x1b[33mNote: Publish your site for changes to go live.\x1b[0m\r\n');

  api.log.info('Custom code injected');
}

async function handleConnect(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  if (args.length === 0) {
    write('\x1b[31mUsage: wf assets connect <file> [options]\x1b[0m\r\n');
    write('\r\nOptions:\r\n');
    write('  --site-head       Inject in site head\r\n');
    write('  --site-body       Inject before site </body>\r\n');
    write('  --page <slug>     Inject on specific page\r\n');
    write('  --async           Load script asynchronously\r\n');
    write('  --defer           Defer script loading\r\n');
    return;
  }

  // Parse arguments
  const fileName = args[0];
  let location: 'head' | 'body' = 'head';
  let type: 'site' | 'page' = 'site';
  let pageSlug: string | undefined;
  let loadStrategy: 'sync' | 'async' | 'defer' = 'sync';

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--site-head':
        type = 'site';
        location = 'head';
        break;
      case '--site-body':
        type = 'site';
        location = 'body';
        break;
      case '--page':
        type = 'page';
        pageSlug = args[++i];
        break;
      case '--async':
        loadStrategy = 'async';
        break;
      case '--defer':
        loadStrategy = 'defer';
        break;
    }
  }

  // Find the asset
  const assetsDir = join(cwd, 'assets');
  const filePath = join(assetsDir, fileName);

  const asset = await storage.getAsset(filePath);
  if (!asset) {
    write(`\x1b[31mAsset not found: ${fileName}\x1b[0m\r\n`);
    write('Upload the asset first with: wf assets upload\r\n');
    return;
  }

  const siteId = await getSiteIdFromConfig(cwd);

  // Add connection
  const connection: AssetConnection = {
    type,
    location,
    siteId,
    pageSlug,
    loadStrategy,
  };

  asset.connections.push(connection);
  await storage.setAsset(asset);

  write(`\x1b[32m✓ Connection added\x1b[0m\r\n\r\n`);
  write(`Asset: ${fileName}\r\n`);
  write(`CDN URL: ${asset.cdnUrl}\r\n`);
  write(`Location: ${type} ${location}\r\n`);
  if (pageSlug) {
    write(`Page: ${pageSlug}\r\n`);
  }
  write(`Load: ${loadStrategy}\r\n`);
  write('\r\nRun "wf assets inject" to apply changes to Webflow.\r\n');
}

async function handleList(
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient,
  storage: StorageManager
): Promise<void> {
  const assets = await storage.getAssets();

  if (assets.length === 0) {
    write('\x1b[33mNo assets uploaded yet.\x1b[0m\r\n');
    write('Use "wf assets upload <file>" to upload assets.\r\n');
    return;
  }

  write('\x1b[1mUploaded Assets\x1b[0m\r\n');
  write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');

  for (const asset of assets) {
    const fileName = basename(asset.localPath);
    write(`\x1b[1m${fileName}\x1b[0m\r\n`);
    write(`  CDN: ${asset.cdnUrl}\r\n`);
    write(`  Uploaded: ${new Date(asset.lastUploaded).toLocaleString()}\r\n`);

    if (asset.connections.length > 0) {
      write('  Connections:\r\n');
      for (const conn of asset.connections) {
        if (conn.type === 'site') {
          write(`    • Site ${conn.location}\r\n`);
        } else if (conn.type === 'page') {
          write(`    • Page: ${conn.pageSlug} (${conn.location})\r\n`);
        }
      }
    } else {
      write('  \x1b[90mNo connections configured\x1b[0m\r\n');
    }
    write('\r\n');
  }
}

// Helper functions

async function getSiteIdFromConfig(cwd: string): Promise<string | undefined> {
  // Try .webflowrc.json
  const webflowrcPath = join(cwd, '.webflowrc.json');
  if (existsSync(webflowrcPath)) {
    const config = JSON.parse(readFileSync(webflowrcPath, 'utf-8'));
    return config.siteId;
  }

  // Try .colab.json
  const colabPath = join(cwd, '.colab.json');
  if (existsSync(colabPath)) {
    const config = JSON.parse(readFileSync(colabPath, 'utf-8'));
    return config.siteId;
  }

  return undefined;
}

function findAssetFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...findAssetFiles(fullPath));
    } else if (isUploadableFile(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

function isUploadableFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  const uploadable = [
    '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.woff', '.woff2', '.ttf', '.eot', '.json', '.xml', '.txt',
  ];
  return uploadable.includes(ext);
}

function generateTag(cdnUrl: string, conn: AssetConnection): string {
  const ext = extname(cdnUrl).toLowerCase();

  if (ext === '.css') {
    return `<link rel="stylesheet" href="${cdnUrl}">`;
  }

  if (ext === '.js') {
    const attrs = [
      `src="${cdnUrl}"`,
    ];
    if (conn.loadStrategy === 'async') {
      attrs.push('async');
    } else if (conn.loadStrategy === 'defer') {
      attrs.push('defer');
    }
    return `<script ${attrs.join(' ')}></script>`;
  }

  // For other files, just return a comment with the URL
  return `<!-- Asset: ${cdnUrl} -->`;
}

function printHelp(write: (text: string) => void): void {
  write('\x1b[1;36mAssets Commands\x1b[0m\r\n');
  write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');

  write('Upload assets to Webflow CDN and inject them as custom code.\r\n\r\n');

  write('\x1b[1mCommands:\x1b[0m\r\n');
  write('  wf assets upload <file>   Upload a file to Webflow CDN\r\n');
  write('  wf assets sync            Sync all files in assets/ directory\r\n');
  write('  wf assets connect         Configure where an asset is injected\r\n');
  write('  wf assets inject          Apply asset connections to Webflow\r\n');
  write('  wf assets list            List uploaded assets\r\n');
  write('\r\n');

  write('\x1b[1mWorkflow:\x1b[0m\r\n');
  write('  1. Create an assets/ directory in your project\r\n');
  write('  2. Add your JS/CSS/SVG files\r\n');
  write('  3. Run "wf assets sync" to upload them\r\n');
  write('  4. Run "wf assets connect <file> --site-head" to configure injection\r\n');
  write('  5. Run "wf assets inject" to update Webflow custom code\r\n');
  write('  6. Publish your site in Webflow\r\n');
  write('\r\n');
}
