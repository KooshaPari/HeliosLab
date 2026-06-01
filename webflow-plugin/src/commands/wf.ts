/**
 * Terminal Command Handler: wf
 *
 * Usage:
 *   wf auth                    - Authenticate with Webflow
 *   wf auth logout             - Clear stored credentials
 *   wf sites                   - List accessible sites
 *   wf devlink init            - Initialize DevLink in current directory
 *   wf devlink pull            - Pull components from Webflow
 *   wf devlink push            - Push code components to Webflow (future)
 *   wf devlink status          - Show sync status
 *   wf components init         - Initialize a Code Components library
 *   wf components share        - Share library to Webflow
 *   wf cloud init              - Scaffold a Webflow Cloud project
 *   wf cloud deploy            - Deploy to Webflow Cloud
 *   wf cloud logs              - View deployment logs
 *   wf assets upload <file>    - Upload asset to Webflow CDN
 *   wf assets sync             - Sync all assets in project
 *   wf assets inject           - Update custom code with asset references
 */

import type { PluginAPI, TerminalCommandContext } from '../../../src/main/plugins/types';
import type { WebflowClient } from '../api/client';
import type { StorageManager } from '../storage/manager';
import { handleAuthCommand } from './auth';
import { handleDevlinkCommand } from './devlink';
import { handleCloudCommand } from './cloud';
import { handleAssetsCommand } from './assets';
import { handleComponentsCommand } from './components';

export async function handleWfCommand(
  ctx: TerminalCommandContext,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  const { args, write, cwd } = ctx;

  if (args.length === 0) {
    printHelp(write);
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  try {
    switch (subcommand) {
      case 'help':
      case '--help':
      case '-h':
        printHelp(write);
        break;

      case 'auth':
        await handleAuthCommand(subArgs, write, client, storage, api);
        break;

      case 'sites':
        await handleSitesCommand(write, client);
        break;

      case 'devlink':
        await handleDevlinkCommand(subArgs, write, cwd, client, storage, api);
        break;

      case 'components':
        await handleComponentsCommand(subArgs, write, cwd, client, storage, api);
        break;

      case 'cloud':
        await handleCloudCommand(subArgs, write, cwd, client, storage, api);
        break;

      case 'assets':
        await handleAssetsCommand(subArgs, write, cwd, client, storage, api);
        break;

      default:
        write(`\x1b[31mUnknown command: ${subcommand}\x1b[0m\r\n`);
        write('Run "wf help" for available commands.\r\n');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`\x1b[31mError: ${message}\x1b[0m\r\n`);
  }
}

async function handleSitesCommand(
  write: (text: string) => void,
  client: WebflowClient
): Promise<void> {
  write('\x1b[36mFetching sites...\x1b[0m\r\n\r\n');

  const sites = await client.listSites();

  if (sites.length === 0) {
    write('No sites found. Make sure your token has access to at least one site.\r\n');
    return;
  }

  write(`Found ${sites.length} site(s):\r\n\r\n`);

  for (const site of sites) {
    write(`  \x1b[1m${site.displayName}\x1b[0m\r\n`);
    write(`  ID: ${site.id}\r\n`);
    write(`  Short name: ${site.shortName}\r\n`);
    if (site.previewUrl) {
      write(`  Preview: ${site.previewUrl}\r\n`);
    }
    if (site.lastPublished) {
      write(`  Last published: ${new Date(site.lastPublished).toLocaleString()}\r\n`);
    }
    write('\r\n');
  }
}

function printHelp(write: (text: string) => void): void {
  write('\x1b[1;36mWebflow CLI for Colab\x1b[0m\r\n');
  write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');

  write('\x1b[1mAuthentication:\x1b[0m\r\n');
  write('  wf auth              Connect your Webflow account\r\n');
  write('  wf auth logout       Clear stored credentials\r\n');
  write('  wf auth status       Show current auth status\r\n');
  write('  wf sites             List accessible sites\r\n');
  write('\r\n');

  write('\x1b[1mDevLink (Webflow → Code):\x1b[0m\r\n');
  write('  wf devlink init      Initialize DevLink in current directory\r\n');
  write('  wf devlink pull      Pull components from Webflow Designer\r\n');
  write('  wf devlink status    Show sync status\r\n');
  write('  wf devlink watch     Watch for changes and auto-sync\r\n');
  write('\r\n');

  write('\x1b[1mCode Components (Code → Webflow):\x1b[0m\r\n');
  write('  wf components init   Initialize a Code Components library\r\n');
  write('  wf components share  Share library to Webflow Designer\r\n');
  write('  wf components list   List components in library\r\n');
  write('\r\n');

  write('\x1b[1mWebflow Cloud:\x1b[0m\r\n');
  write('  wf cloud init        Scaffold a new Cloud project\r\n');
  write('  wf cloud deploy      Deploy to Webflow Cloud\r\n');
  write('  wf cloud logs        View deployment logs\r\n');
  write('  wf cloud status      Show deployment status\r\n');
  write('\r\n');

  write('\x1b[1mAssets:\x1b[0m\r\n');
  write('  wf assets upload     Upload file to Webflow CDN\r\n');
  write('  wf assets sync       Sync all assets in project\r\n');
  write('  wf assets inject     Update custom code references\r\n');
  write('  wf assets list       List uploaded assets\r\n');
  write('\r\n');

  write('\x1b[90mRun "wf <command> --help" for more info on a command.\x1b[0m\r\n');
}
