/**
 * Code Components Command Handler
 *
 * Handles sharing React components from code to Webflow Designer
 *
 * Commands:
 *   wf components init    - Initialize a Code Components library
 *   wf components share   - Share library to Webflow
 *   wf components list    - List components in library
 */

import type { PluginAPI } from '../../../src/main/plugins/types';
import type { WebflowClient } from '../api/client';
import type { StorageManager } from '../storage/manager';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { spawn } from 'child_process';

interface WebflowLibraryConfig {
  name: string;
  version: string;
  components: string[];
}

export async function handleComponentsCommand(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  client: WebflowClient,
  storage: StorageManager,
  api: PluginAPI
): Promise<void> {
  const subcommand = args[0] || 'list';

  switch (subcommand) {
    case 'init':
      await handleInit(args.slice(1), write, cwd, api);
      break;

    case 'share':
    case 'publish':
      await handleShare(write, cwd, api);
      break;

    case 'list':
      await handleList(write, cwd);
      break;

    case 'add':
      await handleAdd(args.slice(1), write, cwd, api);
      break;

    case '--help':
    case 'help':
      printHelp(write);
      break;

    default:
      write(`\x1b[31mUnknown components command: ${subcommand}\x1b[0m\r\n`);
      write('Run "wf components --help" for available commands.\r\n');
  }
}

async function handleInit(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  api: PluginAPI
): Promise<void> {
  // Check if already initialized
  const configPath = join(cwd, 'webflow.json');
  if (existsSync(configPath)) {
    write('\x1b[33mCode Components library already initialized.\x1b[0m\r\n');
    write('Run "wf components share" to publish your library.\r\n');
    return;
  }

  const libraryName = args[0] || basename(cwd) + '-components';

  write(`\x1b[36mInitializing Code Components library: ${libraryName}\x1b[0m\r\n\r\n`);

  // Create webflow.json
  const config: WebflowLibraryConfig = {
    name: libraryName,
    version: '1.0.0',
    components: ['./src/**/*.webflow.tsx'],
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  write(`  \x1b[32m✓\x1b[0m webflow.json\r\n`);

  // Create or update package.json
  const packageJsonPath = join(cwd, 'package.json');
  let packageJson: Record<string, unknown> = {};

  if (existsSync(packageJsonPath)) {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  } else {
    packageJson = {
      name: libraryName,
      version: '1.0.0',
      type: 'module',
    };
  }

  // Add dependencies
  packageJson.dependencies = {
    ...(packageJson.dependencies as Record<string, string> || {}),
    react: '^18.0.0',
    'react-dom': '^18.0.0',
    '@webflow/react': '^0.1.0',
  };

  packageJson.devDependencies = {
    ...(packageJson.devDependencies as Record<string, string> || {}),
    '@webflow/webflow-cli': '^1.1.1',
    typescript: '^5.0.0',
    '@types/react': '^18.0.0',
  };

  packageJson.scripts = {
    ...(packageJson.scripts as Record<string, string> || {}),
    'webflow:share': 'webflow library share',
    'webflow:dev': 'webflow library dev',
  };

  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  write(`  \x1b[32m✓\x1b[0m package.json\r\n`);

  // Create src directory with example component
  const srcDir = join(cwd, 'src');
  if (!existsSync(srcDir)) {
    mkdirSync(srcDir, { recursive: true });
  }

  // Create example component
  const exampleComponent = `import React from 'react';

interface BadgeProps {
  text: string;
  variant?: 'primary' | 'secondary' | 'success' | 'warning';
}

export function Badge({ text, variant = 'primary' }: BadgeProps) {
  const colors = {
    primary: '#4353ff',
    secondary: '#6c757d',
    success: '#28a745',
    warning: '#ffc107',
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 12px',
        borderRadius: '9999px',
        backgroundColor: colors[variant],
        color: variant === 'warning' ? '#000' : '#fff',
        fontSize: '14px',
        fontWeight: 500,
      }}
    >
      {text}
    </span>
  );
}
`;
  writeFileSync(join(srcDir, 'Badge.tsx'), exampleComponent);
  write(`  \x1b[32m✓\x1b[0m src/Badge.tsx (example component)\r\n`);

  // Create webflow declaration file
  const webflowDeclaration = `import { declareComponent } from '@webflow/react';
import { Badge } from './Badge';

export const WebflowBadge = declareComponent(Badge, {
  displayName: 'Badge',
  group: 'UI Elements',
  props: {
    text: {
      type: 'string',
      default: 'Badge',
      label: 'Text',
      description: 'The text to display in the badge',
    },
    variant: {
      type: 'enum',
      options: ['primary', 'secondary', 'success', 'warning'],
      default: 'primary',
      label: 'Variant',
      description: 'The color variant of the badge',
    },
  },
});
`;
  writeFileSync(join(srcDir, 'Badge.webflow.tsx'), webflowDeclaration);
  write(`  \x1b[32m✓\x1b[0m src/Badge.webflow.tsx (component declaration)\r\n`);

  // Create tsconfig.json if not exists
  const tsconfigPath = join(cwd, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        lib: ['DOM', 'DOM.Iterable', 'ESNext'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        outDir: './dist',
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    };
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
    write(`  \x1b[32m✓\x1b[0m tsconfig.json\r\n`);
  }

  write('\r\n\x1b[32m✓ Code Components library initialized!\x1b[0m\r\n\r\n');
  write('Next steps:\r\n');
  write('  1. Run: bun install\r\n');
  write('  2. Create your components in src/\r\n');
  write('  3. Create .webflow.tsx files with declareComponent()\r\n');
  write('  4. Run: wf components share\r\n');
  write('\r\n');
  write('Example component created: src/Badge.tsx + src/Badge.webflow.tsx\r\n');

  api.log.info(`Code Components library initialized: ${libraryName}`);
}

async function handleShare(
  write: (text: string) => void,
  cwd: string,
  api: PluginAPI
): Promise<void> {
  const configPath = join(cwd, 'webflow.json');
  if (!existsSync(configPath)) {
    write('\x1b[31mNo webflow.json found.\x1b[0m\r\n');
    write('Run "wf components init" first.\r\n');
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

  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as WebflowLibraryConfig;

  write(`\x1b[36mSharing library: ${config.name}...\x1b[0m\r\n\r\n`);

  const bunPath = process.env.BUN_BINARY_PATH || 'bun';

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bunPath, ['run', 'webflow', 'library', 'share'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          WEBFLOW_SITE_API_TOKEN: validToken.token,
        },
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

    write('\r\n\x1b[32m✓ Library shared successfully!\x1b[0m\r\n\r\n');
    write('To use your components:\r\n');
    write('  1. Open Webflow Designer\r\n');
    write('  2. Go to the Libraries panel\r\n');
    write('  3. Install your library\r\n');
    write('  4. Drag components onto the canvas\r\n');

    api.log.info(`Code Components library shared: ${config.name}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    if (message.includes('not found') || message.includes('ENOENT')) {
      write('\x1b[31mWebflow CLI not found.\x1b[0m\r\n');
      write('Run "bun install" to install dependencies.\r\n');
    } else {
      write(`\x1b[31mShare failed: ${message}\x1b[0m\r\n`);
    }

    api.log.error('Code Components share failed:', e);
  }
}

async function handleList(
  write: (text: string) => void,
  cwd: string
): Promise<void> {
  const configPath = join(cwd, 'webflow.json');
  if (!existsSync(configPath)) {
    write('\x1b[33mNo webflow.json found.\x1b[0m\r\n');
    write('Run "wf components init" to create a library.\r\n');
    return;
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as WebflowLibraryConfig;

  write(`\x1b[1m${config.name}\x1b[0m v${config.version}\r\n`);
  write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');

  // Find .webflow.tsx files
  const srcDir = join(cwd, 'src');
  if (!existsSync(srcDir)) {
    write('No src/ directory found.\r\n');
    return;
  }

  const webflowFiles = findWebflowFiles(srcDir);

  if (webflowFiles.length === 0) {
    write('No component declarations found.\r\n');
    write('Create .webflow.tsx files with declareComponent() to add components.\r\n');
    return;
  }

  write('Components:\r\n\r\n');

  for (const file of webflowFiles) {
    const componentName = basename(file).replace('.webflow.tsx', '');
    write(`  • ${componentName}\r\n`);
    write(`    \x1b[90m${file.replace(cwd + '/', '')}\x1b[0m\r\n\r\n`);
  }

  write(`Total: ${webflowFiles.length} component(s)\r\n`);
}

async function handleAdd(
  args: string[],
  write: (text: string) => void,
  cwd: string,
  api: PluginAPI
): Promise<void> {
  if (args.length === 0) {
    write('\x1b[31mUsage: wf components add <ComponentName>\x1b[0m\r\n');
    return;
  }

  const componentName = args[0];
  const srcDir = join(cwd, 'src');

  if (!existsSync(srcDir)) {
    mkdirSync(srcDir, { recursive: true });
  }

  // Check if component already exists
  const componentPath = join(srcDir, `${componentName}.tsx`);
  if (existsSync(componentPath)) {
    write(`\x1b[31mComponent ${componentName} already exists.\x1b[0m\r\n`);
    return;
  }

  // Create component file
  const componentContent = `import React from 'react';

interface ${componentName}Props {
  // Add your props here
}

export function ${componentName}({ }: ${componentName}Props) {
  return (
    <div>
      <h1>${componentName}</h1>
      {/* Your component content */}
    </div>
  );
}
`;
  writeFileSync(componentPath, componentContent);
  write(`  \x1b[32m✓\x1b[0m src/${componentName}.tsx\r\n`);

  // Create webflow declaration file
  const declarationPath = join(srcDir, `${componentName}.webflow.tsx`);
  const declarationContent = `import { declareComponent } from '@webflow/react';
import { ${componentName} } from './${componentName}';

export const Webflow${componentName} = declareComponent(${componentName}, {
  displayName: '${componentName}',
  group: 'Custom',
  props: {
    // Define your props for the Webflow Designer here
    // Example:
    // title: {
    //   type: 'string',
    //   default: 'Hello',
    //   label: 'Title',
    // },
  },
});
`;
  writeFileSync(declarationPath, declarationContent);
  write(`  \x1b[32m✓\x1b[0m src/${componentName}.webflow.tsx\r\n`);

  write(`\r\n\x1b[32m✓ Component ${componentName} created!\x1b[0m\r\n\r\n`);
  write('Edit the files to add your component logic and Webflow props.\r\n');
  write('Then run "wf components share" to publish.\r\n');

  api.log.info(`Created component: ${componentName}`);
}

function findWebflowFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findWebflowFiles(fullPath));
    } else if (entry.name.endsWith('.webflow.tsx')) {
      files.push(fullPath);
    }
  }

  return files;
}

function printHelp(write: (text: string) => void): void {
  write('\x1b[1;36mCode Components Commands\x1b[0m\r\n');
  write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');

  write('Create and share React components to use in Webflow Designer.\r\n');
  write('Designers can drag your components onto the canvas and configure\r\n');
  write('them using the props you define.\r\n\r\n');

  write('\x1b[1mCommands:\x1b[0m\r\n');
  write('  wf components init [name]   Initialize a component library\r\n');
  write('  wf components add <name>    Create a new component\r\n');
  write('  wf components list          List components in library\r\n');
  write('  wf components share         Share library to Webflow\r\n');
  write('\r\n');

  write('\x1b[1mWorkflow:\x1b[0m\r\n');
  write('  1. Create component: src/MyComponent.tsx\r\n');
  write('  2. Create declaration: src/MyComponent.webflow.tsx\r\n');
  write('  3. Use declareComponent() to define props for Designer\r\n');
  write('  4. Run "wf components share"\r\n');
  write('  5. Install library in Webflow Designer\r\n');
  write('\r\n');

  write('\x1b[1mExample:\x1b[0m\r\n');
  write('  wf components init my-ui\r\n');
  write('  wf components add Button\r\n');
  write('  wf components share\r\n');
  write('\r\n');
}
