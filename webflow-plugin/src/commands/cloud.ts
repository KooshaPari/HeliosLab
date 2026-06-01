/**
 * Webflow Cloud Command Handler
 *
 * Handles deploying Next.js/Astro apps to Webflow Cloud
 *
 * Commands:
 *   wf cloud init      - Scaffold a new Cloud project
 *   wf cloud deploy    - Deploy to Webflow Cloud
 *   wf cloud logs      - View deployment logs
 *   wf cloud status    - Show deployment status
 */

import type { PluginAPI } from '../../../src/main/plugins/types';
import type { WebflowClient } from '../api/client';
import type { StorageManager } from '../storage/manager';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

interface CloudConfig {
  siteId: string;
  siteName?: string;
  framework: 'astro' | 'nextjs';
  mountPath: string;
  devlinkEnabled?: boolean;
}

export async function handleCloudCommand(
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

    case 'deploy':
      await handleDeploy(args.slice(1), write, cwd, api);
      break;

    case 'logs':
      await handleLogs(write, cwd, api);
      break;

    case 'status':
      await handleStatus(write, cwd, client);
      break;

    case 'dev':
      await handleDev(write, cwd, api);
      break;

    case '--help':
    case 'help':
      printHelp(write);
      break;

    default:
      write(`\x1b[31mUnknown cloud command: ${subcommand}\x1b[0m\r\n`);
      write('Run "wf cloud --help" for available commands.\r\n');
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
  // Parse arguments
  let siteId: string | undefined;
  let framework: 'astro' | 'nextjs' = 'astro';
  let mountPath = '/app';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--framework' || args[i] === '-f') {
      const f = args[++i];
      if (f === 'astro' || f === 'nextjs') {
        framework = f;
      }
    } else if (args[i] === '--mount' || args[i] === '-m') {
      mountPath = args[++i] || '/app';
    } else if (!siteId && !args[i].startsWith('-')) {
      siteId = args[i];
    }
  }

  // Check authentication
  if (!await client.isAuthenticated()) {
    write('\x1b[31mNot authenticated.\x1b[0m Run "wf auth" first.\r\n');
    return;
  }

  // Get site ID if not provided
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

    write('\r\nRun: wf cloud init <site_id> [--framework astro|nextjs] [--mount /path]\r\n');
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
    return;
  }

  write(`Scaffolding ${framework === 'astro' ? 'Astro' : 'Next.js'} project...\r\n\r\n`);

  // Create project structure based on framework
  if (framework === 'astro') {
    await scaffoldAstroProject(cwd, siteId, siteName, mountPath, write);
  } else {
    await scaffoldNextjsProject(cwd, siteId, siteName, mountPath, write);
  }

  // Create .colab.json marker
  const colabConfig = {
    type: 'webflow-cloud',
    name: `Cloud: ${siteName}`,
    siteId,
    siteName,
    framework,
    mountPath,
  };
  writeFileSync(join(cwd, '.colab.json'), JSON.stringify(colabConfig, null, 2));
  write(`  \x1b[32m✓\x1b[0m .colab.json\r\n`);

  write('\r\n\x1b[32m✓ Webflow Cloud project created!\x1b[0m\r\n\r\n');
  write('Next steps:\r\n');
  write('  1. Run: bun install\r\n');
  write('  2. Run: wf cloud dev (for local development)\r\n');
  write('  3. Run: wf cloud deploy (to deploy)\r\n');
  write(`\r\nYour app will be mounted at: ${siteName}.webflow.io${mountPath}\r\n`);

  api.log.info(`Webflow Cloud project created for: ${siteName}`);
}

async function scaffoldAstroProject(
  cwd: string,
  siteId: string,
  siteName: string,
  mountPath: string,
  write: (text: string) => void
): Promise<void> {
  // package.json
  const packageJson = {
    name: siteName.toLowerCase().replace(/\s+/g, '-') + '-cloud',
    type: 'module',
    version: '0.0.1',
    scripts: {
      dev: 'astro dev',
      build: 'astro build',
      preview: 'astro preview',
      'wf:dev': 'wrangler dev',
      'wf:deploy': 'wrangler deploy',
    },
    dependencies: {
      astro: '^4.0.0',
      '@astrojs/cloudflare': '^10.0.0',
    },
    devDependencies: {
      wrangler: '^3.0.0',
      '@webflow/webflow-cli': '^1.1.1',
    },
  };
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(packageJson, null, 2));
  write(`  \x1b[32m✓\x1b[0m package.json\r\n`);

  // astro.config.mjs
  const astroConfig = `import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
  }),
  base: '${mountPath}',
});
`;
  writeFileSync(join(cwd, 'astro.config.mjs'), astroConfig);
  write(`  \x1b[32m✓\x1b[0m astro.config.mjs\r\n`);

  // wrangler.toml
  const wranglerConfig = `name = "${siteName.toLowerCase().replace(/\s+/g, '-')}"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[site]
bucket = "./dist"
`;
  writeFileSync(join(cwd, 'wrangler.toml'), wranglerConfig);
  write(`  \x1b[32m✓\x1b[0m wrangler.toml\r\n`);

  // Create src directory structure
  mkdirSync(join(cwd, 'src', 'pages'), { recursive: true });
  mkdirSync(join(cwd, 'src', 'layouts'), { recursive: true });
  mkdirSync(join(cwd, 'public'), { recursive: true });

  // Create index page
  const indexPage = `---
// This page will be available at ${siteName}.webflow.io${mountPath}
---

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${siteName} - Cloud App</title>
</head>
<body>
  <main>
    <h1>Welcome to ${siteName}</h1>
    <p>This is your Webflow Cloud app running on Astro.</p>
    <p>Mounted at: <code>${mountPath}</code></p>
  </main>
</body>
</html>
`;
  writeFileSync(join(cwd, 'src', 'pages', 'index.astro'), indexPage);
  write(`  \x1b[32m✓\x1b[0m src/pages/index.astro\r\n`);

  // Create .webflowrc.json for DevLink integration
  const webflowrc = {
    siteId,
    siteName,
    componentsPath: './src/components/devlink',
  };
  writeFileSync(join(cwd, '.webflowrc.json'), JSON.stringify(webflowrc, null, 2));
  write(`  \x1b[32m✓\x1b[0m .webflowrc.json (DevLink ready)\r\n`);
}

async function scaffoldNextjsProject(
  cwd: string,
  siteId: string,
  siteName: string,
  mountPath: string,
  write: (text: string) => void
): Promise<void> {
  // package.json
  const packageJson = {
    name: siteName.toLowerCase().replace(/\s+/g, '-') + '-cloud',
    version: '0.0.1',
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      'wf:dev': 'wrangler dev',
      'wf:deploy': 'wrangler deploy',
    },
    dependencies: {
      next: '^15.0.0',
      react: '^18.0.0',
      'react-dom': '^18.0.0',
    },
    devDependencies: {
      '@opennextjs/cloudflare': '^0.2.0',
      wrangler: '^3.0.0',
      '@webflow/webflow-cli': '^1.1.1',
      typescript: '^5.0.0',
      '@types/react': '^18.0.0',
      '@types/node': '^20.0.0',
    },
  };
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(packageJson, null, 2));
  write(`  \x1b[32m✓\x1b[0m package.json\r\n`);

  // next.config.js
  const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '${mountPath}',
  // Enable edge runtime for Cloudflare
  experimental: {
    runtime: 'edge',
  },
};

module.exports = nextConfig;
`;
  writeFileSync(join(cwd, 'next.config.js'), nextConfig);
  write(`  \x1b[32m✓\x1b[0m next.config.js\r\n`);

  // wrangler.toml
  const wranglerConfig = `name = "${siteName.toLowerCase().replace(/\s+/g, '-')}"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[site]
bucket = "./.open-next/assets"

[[kv_namespaces]]
binding = "NEXT_CACHE_WORKERS_KV"
id = "your-kv-namespace-id"
`;
  writeFileSync(join(cwd, 'wrangler.toml'), wranglerConfig);
  write(`  \x1b[32m✓\x1b[0m wrangler.toml\r\n`);

  // Create app directory structure
  mkdirSync(join(cwd, 'app'), { recursive: true });
  mkdirSync(join(cwd, 'public'), { recursive: true });

  // Create layout
  const layout = `export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
  writeFileSync(join(cwd, 'app', 'layout.tsx'), layout);
  write(`  \x1b[32m✓\x1b[0m app/layout.tsx\r\n`);

  // Create index page
  const indexPage = `export default function Home() {
  return (
    <main>
      <h1>Welcome to ${siteName}</h1>
      <p>This is your Webflow Cloud app running on Next.js.</p>
      <p>Mounted at: <code>${mountPath}</code></p>
    </main>
  );
}
`;
  writeFileSync(join(cwd, 'app', 'page.tsx'), indexPage);
  write(`  \x1b[32m✓\x1b[0m app/page.tsx\r\n`);

  // Create tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  };
  writeFileSync(join(cwd, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  write(`  \x1b[32m✓\x1b[0m tsconfig.json\r\n`);

  // Create .webflowrc.json for DevLink integration
  const webflowrc = {
    siteId,
    siteName,
    componentsPath: './components/devlink',
  };
  writeFileSync(join(cwd, '.webflowrc.json'), JSON.stringify(webflowrc, null, 2));
  write(`  \x1b[32m✓\x1b[0m .webflowrc.json (DevLink ready)\r\n`);
}

async function handleDeploy(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  api: PluginAPI
): Promise<void> {
  // Check for config
  const colabConfigPath = join(cwd, '.colab.json');
  if (!existsSync(colabConfigPath)) {
    write('\x1b[31mNo Webflow Cloud configuration found.\x1b[0m\r\n');
    write('Run "wf cloud init" first.\r\n');
    return;
  }

  write('\x1b[36mBuilding and deploying...\x1b[0m\r\n\r\n');

  const bunPath = process.env.BUN_BINARY_PATH || 'bun';

  try {
    // Build first
    write('\x1b[90m$ bun run build\x1b[0m\r\n');
    await runCommand(bunPath, ['run', 'build'], cwd, write);

    // Then deploy
    write('\r\n\x1b[90m$ bun run wf:deploy\x1b[0m\r\n');
    await runCommand(bunPath, ['run', 'wf:deploy'], cwd, write);

    write('\r\n\x1b[32m✓ Deployment complete!\x1b[0m\r\n');
    api.log.info('Webflow Cloud deployment completed');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    write(`\x1b[31mDeployment failed: ${message}\x1b[0m\r\n`);
    api.log.error('Webflow Cloud deployment failed:', e);
  }
}

async function handleLogs(
  write: (text: string) => void,
  cwd: string,
  api: PluginAPI
): Promise<void> {
  write('\x1b[36mFetching deployment logs...\x1b[0m\r\n\r\n');

  const bunPath = process.env.BUN_BINARY_PATH || 'bun';

  try {
    await runCommand(bunPath, ['x', 'wrangler', 'tail'], cwd, write);
  } catch (e) {
    write('\x1b[33mCould not fetch logs. Make sure wrangler is configured.\x1b[0m\r\n');
  }
}

async function handleStatus(
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient
): Promise<void> {
  const colabConfigPath = join(cwd, '.colab.json');

  if (!existsSync(colabConfigPath)) {
    write('\x1b[33mNo Webflow Cloud configuration found in this directory.\x1b[0m\r\n');
    write('Run "wf cloud init" to create a Cloud project.\r\n');
    return;
  }

  const config = JSON.parse(readFileSync(colabConfigPath, 'utf-8'));

  write('\x1b[1mWebflow Cloud Status\x1b[0m\r\n');
  write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');

  write(`Site: ${config.siteName || 'Unknown'}\r\n`);
  write(`Framework: ${config.framework || 'Unknown'}\r\n`);
  write(`Mount path: ${config.mountPath || '/app'}\r\n`);

  // Check for built output
  const distPath = join(cwd, 'dist');
  const openNextPath = join(cwd, '.open-next');

  if (existsSync(distPath)) {
    write('\r\n\x1b[32m✓ Build output found (dist/)\x1b[0m\r\n');
  } else if (existsSync(openNextPath)) {
    write('\r\n\x1b[32m✓ Build output found (.open-next/)\x1b[0m\r\n');
  } else {
    write('\r\n\x1b[33m⚠ No build output. Run "bun run build" first.\x1b[0m\r\n');
  }
}

async function handleDev(
  write: (text: string) => void,
  cwd: string,
  api: PluginAPI
): Promise<void> {
  write('\x1b[36mStarting development server...\x1b[0m\r\n\r\n');

  const bunPath = process.env.BUN_BINARY_PATH || 'bun';

  try {
    // Use wrangler dev for local development
    write('\x1b[90m$ bun run dev\x1b[0m\r\n');
    await runCommand(bunPath, ['run', 'dev'], cwd, write);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    write(`\x1b[31mDev server failed: ${message}\x1b[0m\r\n`);
  }
}

async function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  write: (text: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    proc.stdout.on('data', (data: Buffer) => {
      write(data.toString().replace(/\n/g, '\r\n'));
    });

    proc.stderr.on('data', (data: Buffer) => {
      write(data.toString().replace(/\n/g, '\r\n'));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

function printHelp(write: (text: string) => void): void {
  write('\x1b[1;36mWebflow Cloud Commands\x1b[0m\r\n');
  write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');

  write('Deploy Next.js or Astro apps to Webflow Cloud.\r\n');
  write('Apps run on Cloudflare\'s edge network and are mounted\r\n');
  write('at a path on your Webflow site.\r\n\r\n');

  write('\x1b[1mCommands:\x1b[0m\r\n');
  write('  wf cloud init [site_id]   Scaffold a new Cloud project\r\n');
  write('  wf cloud dev              Start local dev server\r\n');
  write('  wf cloud deploy           Build and deploy to Cloud\r\n');
  write('  wf cloud logs             View deployment logs\r\n');
  write('  wf cloud status           Show deployment status\r\n');
  write('\r\n');

  write('\x1b[1mOptions:\x1b[0m\r\n');
  write('  --framework, -f   Framework: astro (default) or nextjs\r\n');
  write('  --mount, -m       Mount path: /app (default)\r\n');
  write('\r\n');

  write('\x1b[1mExamples:\x1b[0m\r\n');
  write('  wf cloud init 64abc123 --framework astro --mount /dashboard\r\n');
  write('  wf cloud deploy\r\n');
  write('\r\n');
}
