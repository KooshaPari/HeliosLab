/**
 * Auth Command Handler
 *
 * Handles Webflow OAuth authentication flow
 */

import type { PluginAPI } from '../../../src/main/plugins/types';
import type { WebflowClient } from '../api/client';
import type { StorageManager } from '../storage/manager';

// OAuth configuration - these would typically be environment variables
// For now, using Webflow's standard OAuth flow
const OAUTH_CLIENT_ID = process.env.WEBFLOW_CLIENT_ID || '';
const OAUTH_REDIRECT_URI = process.env.WEBFLOW_REDIRECT_URI || 'http://localhost:3333/callback';
const OAUTH_SCOPES = [
  'sites:read',
  'sites:write',
  'pages:read',
  'pages:write',
  'assets:read',
  'assets:write',
  'custom_code:read',
  'custom_code:write',
].join(' ');

export async function handleAuthCommand(
  args: string[],
  write: (text: string) => void,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  const subcommand = args[0] || 'login';

  switch (subcommand) {
    case 'login':
    case 'connect':
      await handleLogin(write, storage, api);
      break;

    case 'logout':
    case 'disconnect':
      await handleLogout(write, storage, api);
      break;

    case 'status':
      await handleStatus(write, client, storage);
      break;

    case 'token':
      // Allow manually setting a token for development
      if (args[1]) {
        await handleSetToken(args[1], write, storage, api);
      } else {
        write('\x1b[31mUsage: wf auth token <access_token>\x1b[0m\r\n');
      }
      break;

    default:
      write(`\x1b[31mUnknown auth command: ${subcommand}\x1b[0m\r\n`);
      write('Available: login, logout, status, token\r\n');
  }
}

async function handleLogin(
  write: (text: string) => void,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  // Check if already authenticated
  const existingAuth = await storage.getAuth();
  if (existingAuth) {
    write('\x1b[33mYou are already authenticated.\x1b[0m\r\n');
    write('Run "wf auth logout" first to re-authenticate.\r\n');
    return;
  }

  if (!OAUTH_CLIENT_ID) {
    write('\x1b[33mOAuth not configured.\x1b[0m\r\n\r\n');
    write('To authenticate, you can:\r\n');
    write('1. Set WEBFLOW_CLIENT_ID environment variable for OAuth flow\r\n');
    write('2. Use "wf auth token <access_token>" with a personal access token\r\n\r\n');
    write('\x1b[36mTo get a personal access token:\x1b[0m\r\n');
    write('1. Go to https://webflow.com/dashboard/account/integrations\r\n');
    write('2. Click "Generate API token"\r\n');
    write('3. Select the sites you want to access\r\n');
    write('4. Copy the token and run: wf auth token <your_token>\r\n');
    return;
  }

  // Build OAuth URL
  const authUrl = new URL('https://webflow.com/oauth/authorize');
  authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  authUrl.searchParams.set('scope', OAUTH_SCOPES);

  write('\x1b[36mStarting OAuth flow...\x1b[0m\r\n\r\n');
  write('Please open this URL in your browser:\r\n');
  write(`\x1b[4m${authUrl.toString()}\x1b[0m\r\n\r\n`);
  write('After authorizing, you\'ll be redirected. The token will be captured automatically.\r\n');

  // TODO: Start local server to capture OAuth callback
  // For now, instruct users to use the token command
  write('\r\n\x1b[33mNote: Full OAuth flow not yet implemented.\x1b[0m\r\n');
  write('Please use "wf auth token <token>" with a personal access token.\r\n');
}

async function handleLogout(
  write: (text: string) => void,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  const existingAuth = await storage.getAuth();
  if (!existingAuth) {
    write('You are not authenticated.\r\n');
    return;
  }

  await storage.clearAuth();
  write('\x1b[32m✓ Logged out successfully.\x1b[0m\r\n');
  api.log.info('User logged out of Webflow');
}

async function handleStatus(
  write: (text: string) => void,
  client: WebflowClient,
  storage: StorageManager
): Promise<void> {
  const auth = await storage.getAuth();

  if (!auth) {
    write('\x1b[33mNot authenticated.\x1b[0m\r\n');
    write('Run "wf auth" to connect your Webflow account.\r\n');
    return;
  }

  write('\x1b[32m✓ Authenticated\x1b[0m\r\n\r\n');

  if (auth.email) {
    write(`  Email: ${auth.email}\r\n`);
  }

  if (auth.expiresAt) {
    const expiresIn = auth.expiresAt - Date.now();
    if (expiresIn > 0) {
      const hours = Math.floor(expiresIn / (1000 * 60 * 60));
      write(`  Token expires in: ${hours} hours\r\n`);
    } else {
      write('  \x1b[33mToken expired. Run "wf auth" to re-authenticate.\x1b[0m\r\n');
    }
  }

  // Try to fetch sites to verify token works
  try {
    const sites = await client.listSites();
    write(`  Accessible sites: ${sites.length}\r\n`);
  } catch (e) {
    write('  \x1b[31mFailed to verify token. It may be invalid or expired.\x1b[0m\r\n');
  }
}

async function handleSetToken(
  token: string,
  write: (text: string) => void,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  write('\x1b[36mVerifying token...\x1b[0m\r\n');

  // Store the token
  await storage.setAuth({
    accessToken: token,
  });

  // Try to verify it works by fetching sites
  try {
    const response = await fetch('https://api.webflow.com/v2/sites', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      await storage.clearAuth();
      write(`\x1b[31mInvalid token. API returned: ${response.status}\x1b[0m\r\n`);
      return;
    }

    const data = await response.json() as { sites: Array<{ displayName: string }> };
    write(`\x1b[32m✓ Token verified successfully!\x1b[0m\r\n`);
    write(`  Access to ${data.sites.length} site(s)\r\n`);

    api.log.info('Webflow token set successfully');
  } catch (e) {
    await storage.clearAuth();
    write(`\x1b[31mFailed to verify token: ${e}\x1b[0m\r\n`);
  }
}
