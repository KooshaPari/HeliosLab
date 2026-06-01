/**
 * DevLink Command Handler
 *
 * Handles syncing visual components from Webflow Designer to code
 *
 * Commands:
 *   wf devlink init      - Initialize DevLink in current directory
 *   wf devlink pull      - Pull components from Webflow
 *   wf devlink status    - Show sync status
 *   wf devlink watch     - Watch for changes
 */

import type { PluginAPI } from '../../../src/main/plugins/types';
import type { WebflowClient } from '../api/client';
import type { StorageManager } from '../storage/manager';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

interface DevLinkConfig {
  siteId: string;
  siteName?: string;
  componentsPath?: string;
  host?: string;
}

export async function handleDevlinkCommand(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  const subcommand = args[0] || 'status';

  switch (subcommand) {
    case 'init':
      await handleInit(args.slice(1), write, cwd, client, storage, api);
      break;

    case 'pull':
    case 'sync':
      await handlePull(write, cwd, api);
      break;

    case 'status':
      await handleStatus(write, cwd, client);
      break;

    case 'watch':
      await handleWatch(write, cwd, api);
      break;

    case '--help':
    case 'help':
      printHelp(write);
      break;

    default:
      write(`\x1b[31mUnknown devlink command: ${subcommand}\x1b[0m\r\n`);
      write('Run "wf devlink --help" for available commands.\r\n');
  }
}

async function handleInit(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  // Check if already initialized
  const configPath = join(cwd, '.webflowrc.json');
  if (existsSync(configPath)) {
    write('\x1b[33mDevLink is already initialized in this directory.\x1b[0m\r\n');
    write('Run "wf devlink pull" to sync components.\r\n');
    return;
  }

  // Check authentication
  if (!await client.isAuthenticated()) {
    write('\x1b[31mNot authenticated.\x1b[0m Run "wf auth" first.\r\n');
    return;
  }

  // Get site ID from args or prompt
  let siteId = args[0];

  if (!siteId) {
    write('\x1b[36mFetching your sites...\x1b[0m\r\n\r\n');
    const sites = await client.listSites();

    if (sites.length === 0) {
      write('\x1b[31mNo sites found.\x1b[0m Make sure your token has access to at least one site.\r\n');
      return;
    }

    write('Available sites:\r\n\r\n');
    sites.forEach((site, i) => {
      write(`  ${i + 1}. ${site.displayName} (${site.shortName})\r\n`);
      write(`     ID: ${site.id}\r\n\r\n`);
    });

    write('\r\nRun: wf devlink init <site_id>\r\n');
    return;
  }

  // Verify site access
  write('\x1b[36mVerifying site access...\x1b[0m\r\n');
  let siteName = siteId;
  try {
    const site = await client.getSite(siteId);
    siteName = site.displayName;
    write(`\x1b[32m✓ Found site: ${siteName}\x1b[0m\r\n\r\n`);
  } catch (e) {
    write(`\x1b[31mCould not access site: ${siteId}\x1b[0m\r\n`);
    write('Make sure the site ID is correct and your token has access.\r\n');
    return;
  }

  // Create .webflowrc.json
  const config: DevLinkConfig = {
    siteId,
    siteName,
    componentsPath: './devlink',
  };

  write('Creating configuration files...\r\n');

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  write(`  \x1b[32m✓\x1b[0m .webflowrc.json\r\n`);

  // Create or update package.json with webflow-cli dependency
  const packageJsonPath = join(cwd, 'package.json');
  let packageJson: Record<string, unknown> = {};

  if (existsSync(packageJsonPath)) {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  } else {
    packageJson = {
      name: 'webflow-project',
      version: '1.0.0',
      type: 'module',
    };
  }

  // Add devDependencies
  packageJson.devDependencies = {
    ...(packageJson.devDependencies as Record<string, string> || {}),
    '@webflow/webflow-cli': '^1.1.1',
  };

  // Add scripts
  packageJson.scripts = {
    ...(packageJson.scripts as Record<string, string> || {}),
    'webflow:sync': 'webflow devlink sync',
  };

  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  write(`  \x1b[32m✓\x1b[0m package.json (added @webflow/webflow-cli)\r\n`);

  // Create devlink directory
  const devlinkPath = join(cwd, 'devlink');
  if (!existsSync(devlinkPath)) {
    mkdirSync(devlinkPath, { recursive: true });
    write(`  \x1b[32m✓\x1b[0m devlink/ directory\r\n`);
  }

  write('\r\n\x1b[32m✓ DevLink initialized successfully!\x1b[0m\r\n\r\n');
  write('Next steps:\r\n');
  write('  1. Run: bun install (or npm install)\r\n');
  write('  2. Run: wf devlink pull\r\n');
  write('\r\n');

  api.log.info(`DevLink initialized for site: ${siteName} (${siteId})`);
}

async function handlePull(
  write: (text: string) => void,
  cwd: string,
  api: PluginAPI
): Promise<void> {
  // Check for config
  const configPath = join(cwd, '.webflowrc.json');
  if (!existsSync(configPath)) {
    write('\x1b[31mNo DevLink configuration found.\x1b[0m\r\n');
    write('Run "wf devlink init" first.\r\n');
    return;
  }

  // Get OAuth token from plugin state
  interface WebflowToken {
    id: string;
    token: string;
    status: 'idle' | 'validating' | 'valid' | 'invalid';
  }
  const tokens = api.state.get<WebflowToken[]>('tokens') || [];
  const validToken = tokens.find(t => t.status === 'valid');

  if (!validToken) {
    write('\x1b[31mNot authenticated.\x1b[0m\r\n');
    write('Connect your Webflow account in Settings → Webflow first.\r\n');
    return;
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as DevLinkConfig;

  write(`\x1b[36mSyncing components from ${config.siteName || config.siteId}...\x1b[0m\r\n\r\n`);

  // Run webflow devlink sync via bun
  const bunPath = process.env.BUN_BINARY_PATH || 'bun';

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bunPath, ['run', 'webflow', 'devlink', 'sync'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          WEBFLOW_SITE_API_TOKEN: validToken.token,
          // Disable telemetry prompt - we're running non-interactively
          WEBFLOW_TELEMETRY: 'false',
          DO_NOT_TRACK: '1',
        },
      });

      proc.stdout.on('data', (data: Buffer) => {
        write(data.toString().replace(/\n/g, '\r\n'));
      });

      proc.stderr.on('data', (data: Buffer) => {
        write(`\x1b[33m${data.toString().replace(/\n/g, '\r\n')}\x1b[0m`);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });

    write('\r\n\x1b[32m✓ Sync complete!\x1b[0m\r\n');
    api.log.info('DevLink sync completed successfully');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    // If webflow CLI not found, give helpful message
    if (message.includes('not found') || message.includes('ENOENT')) {
      write('\x1b[31mWebflow CLI not found.\x1b[0m\r\n');
      write('Run "bun install" to install dependencies.\r\n');
    } else {
      write(`\x1b[31mSync failed: ${message}\x1b[0m\r\n`);
    }

    api.log.error('DevLink sync failed:', e);
  }
}

async function handleStatus(
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient
): Promise<void> {
  const configPath = join(cwd, '.webflowrc.json');

  if (!existsSync(configPath)) {
    write('\x1b[33mNo DevLink configuration found in this directory.\x1b[0m\r\n');
    write('Run "wf devlink init" to initialize.\r\n');
    return;
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as DevLinkConfig;

  write('\x1b[1mDevLink Status\x1b[0m\r\n');
  write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');

  write(`Site: ${config.siteName || 'Unknown'}\r\n`);
  write(`Site ID: ${config.siteId}\r\n`);
  write(`Components path: ${config.componentsPath || './devlink'}\r\n\r\n`);

  // Check if devlink folder exists and count components
  const devlinkPath = join(cwd, config.componentsPath || 'devlink');
  if (existsSync(devlinkPath)) {
    try {
      const { readdirSync } = await import('fs');
      const files = readdirSync(devlinkPath);
      const componentFiles = files.filter(
        (f) => f.endsWith('.tsx') || f.endsWith('.jsx')
      );
      write(`Local components: ${componentFiles.length}\r\n`);

      if (componentFiles.length > 0) {
        write('\r\nComponents:\r\n');
        componentFiles.slice(0, 10).forEach((f) => {
          write(`  • ${f.replace(/\.(tsx|jsx)$/, '')}\r\n`);
        });
        if (componentFiles.length > 10) {
          write(`  ... and ${componentFiles.length - 10} more\r\n`);
        }
      }
    } catch (e) {
      write('\x1b[33mCould not read components directory.\x1b[0m\r\n');
    }
  } else {
    write('\x1b[33mComponents directory not found. Run "wf devlink pull".\x1b[0m\r\n');
  }

  // Try to get site info from API
  if (await client.isAuthenticated()) {
    try {
      const site = await client.getSite(config.siteId);
      write(`\r\nWebflow site: ${site.displayName}\r\n`);
      if (site.lastPublished) {
        write(`Last published: ${new Date(site.lastPublished).toLocaleString()}\r\n`);
      }
    } catch (e) {
      // Silently ignore API errors for status
    }
  }
}

async function handleWatch(
  write: (text: string) => void,
  cwd: string,
  api: PluginAPI
): Promise<void> {
  write('\x1b[33mWatch mode not yet implemented.\x1b[0m\r\n');
  write('For now, run "wf devlink pull" manually to sync.\r\n');

  // TODO: Implement watch mode using fs.watch or chokidar
  // This would watch the Webflow Designer via their sync protocol
}

function printHelp(write: (text: string) => void): void {
  write('\x1b[1;36mDevLink Commands\x1b[0m\r\n');
  write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');

  write('DevLink syncs visual components from Webflow Designer to your codebase.\r\n');
  write('Components are exported as React code that you can use in your apps.\r\n\r\n');

  write('\x1b[1mCommands:\x1b[0m\r\n');
  write('  wf devlink init [site_id]   Initialize DevLink for a site\r\n');
  write('  wf devlink pull             Pull latest components from Webflow\r\n');
  write('  wf devlink status           Show current sync status\r\n');
  write('  wf devlink watch            Watch for changes (coming soon)\r\n');
  write('\r\n');

  write('\x1b[1mExamples:\x1b[0m\r\n');
  write('  wf devlink init                    # List available sites\r\n');
  write('  wf devlink init 64abc123def456     # Init with site ID\r\n');
  write('  wf devlink pull                    # Sync components\r\n');
  write('\r\n');
}
