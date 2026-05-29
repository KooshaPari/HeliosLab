/**
 * Electrobun Demo Plugin for Colab
 *
 * A comprehensive test/demo plugin that demonstrates the FULL Colab plugin API surface.
 * Themed with bunnies (🐰) and lightning bolts (⚡) to celebrate Electrobun!
 *
 * API Categories Demonstrated:
 * ✅ Commands (registerCommand, executeCommand)
 * ✅ Webview (registerPreloadScript)
 * ✅ Workspace (readFile, writeFile, findFiles, exists, getWorkspaceFolders)
 * ✅ Editor (completions, getActiveEditor, getSelection, insertText)
 * ✅ Terminal (registerCommand, createTerminal, sendText)
 * ✅ Shell (exec, openExternal)
 * ✅ Notifications (showInfo, showWarning, showError)
 * ✅ Logging (debug, info, warn, error)
 * ✅ Git (getStatus, getBranch)
 * ✅ Events (onFileChange, onActiveEditorChange)
 * ✅ Status Bar (createItem, update)
 * ✅ File Decorations (registerProvider)
 * ✅ Context Menu (registerItem)
 * ✅ Keybindings (register)
 * ✅ Settings (registerSchema, get, set, onChange)
 * ✅ State (get, set, delete, getAll)
 * ✅ Slates (register, onMount, onUnmount, onEvent, render)
 * ✅ Paths (bun, git, fd, rg, colabHome, plugins)
 * ✅ UI (openUrl)
 * ✅ Utils (getUniqueNewName)
 */

import type { PluginAPI, Disposable } from '../colab/src/main/plugins/types';

let electrobunModeEnabled = false;
const disposables: Disposable[] = [];

// ============================================================================
// Webview Preload Script
// ============================================================================

const preloadScript = `
(function() {
  console.log('⚡🐰 Electrobun preload script loaded!');

  // Demo: Add a little electrobun badge to the page
  setTimeout(function() {
    var badge = document.createElement('div');
    badge.innerHTML = '⚡🐰';
    badge.style.cssText = 'position:fixed;bottom:10px;right:10px;background:#1a1a2e;color:#fff;padding:8px 12px;border-radius:8px;font-size:20px;z-index:999999;box-shadow:0 2px 10px rgba(0,0,0,0.3);';
    badge.title = 'Powered by Electrobun!';
    document.body.appendChild(badge);
    console.log('⚡ Electrobun badge added to page');
  }, 1000);
})();
`;

// ============================================================================
// Main Plugin Activation
// ============================================================================

export async function activate(api: PluginAPI): Promise<void> {
  api.log.info('⚡🐰 Electrobun Demo Plugin activating...');
  api.log.info(`Plugin: ${api.plugin.name} v${api.plugin.version}`);

  // Helper for flash messages
  let flashStatus: (message: string, duration?: number) => void = () => {};

  // --------------------------------------------------------------------------
  // 1. WEBVIEW: Register preload script
  // --------------------------------------------------------------------------
  const preloadDisposable = api.webview.registerPreloadScript(preloadScript);
  disposables.push(preloadDisposable);
  api.log.info('✓ Webview preload script registered');

  // --------------------------------------------------------------------------
  // 2. COMMANDS: Register various commands
  // --------------------------------------------------------------------------

  // Enable command
  const zapDisposable = api.commands.registerCommand('electrobun.zap', async () => {
    electrobunModeEnabled = true;
    api.log.info('⚡ ZAP! Electrobun mode enabled!');
    api.notifications.showInfo('⚡🐰 Electrobun mode ACTIVATED!');
    flashStatus('⚡ ZAPPED! ⚡', 3000);

    // Demo: increment activation count in state
    const activations = (api.state.get<number>('activationCount') || 0) + 1;
    api.state.set('activationCount', activations);
    api.log.info(`Total activations: ${activations}`);

    return { enabled: true, activations };
  });
  disposables.push(zapDisposable);

  // Disable command
  const restDisposable = api.commands.registerCommand('electrobun.rest', async () => {
    electrobunModeEnabled = false;
    api.log.info('🐰 Rest mode - Electrobun sleeping');
    api.notifications.showInfo('🐰💤 Electrobun is resting...');
    flashStatus('🐰 Resting...', 3000);
    return { enabled: false };
  });
  disposables.push(restDisposable);

  // Git status command
  const gitStatusDisposable = api.commands.registerCommand('electrobun.showGitStatus', async () => {
    try {
      const folders = await api.workspace.getWorkspaceFolders();
      if (folders.length === 0) {
        api.notifications.showWarning('No workspace folder open');
        return;
      }
      const branch = await api.git.getBranch(folders[0].path);
      const status = await api.git.getStatus(folders[0].path);
      api.notifications.showInfo(`⚡ Branch: ${branch}`);
      api.log.info('Git status:', status);
      return { branch, status };
    } catch (err) {
      api.notifications.showError(`Git error: ${err}`);
    }
  });
  disposables.push(gitStatusDisposable);

  // Find files command
  const findFilesDisposable = api.commands.registerCommand('electrobun.findFiles', async () => {
    try {
      const files = await api.workspace.findFiles('**/*.ts');
      api.notifications.showInfo(`⚡ Found ${files.length} TypeScript files`);
      api.log.info('TypeScript files:', files.slice(0, 10));
      return { count: files.length, sample: files.slice(0, 10) };
    } catch (err) {
      api.notifications.showError(`Find files error: ${err}`);
    }
  });
  disposables.push(findFilesDisposable);

  // Shell command demo
  const shellDisposable = api.commands.registerCommand('electrobun.runShell', async () => {
    try {
      const result = await api.shell.exec('echo "⚡🐰 Hello from shell!"', { timeout: 5000 });
      api.notifications.showInfo(`Shell output: ${result.stdout.trim()}`);
      api.log.info('Shell result:', result);
      return result;
    } catch (err) {
      api.notifications.showError(`Shell error: ${err}`);
    }
  });
  disposables.push(shellDisposable);

  // Open docs command
  const openDocsDisposable = api.commands.registerCommand('electrobun.openDocs', async () => {
    api.ui.openUrl('https://electrobun.dev');
    api.notifications.showInfo('⚡ Opening Electrobun docs...');
  });
  disposables.push(openDocsDisposable);

  api.log.info('✓ Commands registered (6 commands)');

  // --------------------------------------------------------------------------
  // 3. TERMINAL: Register terminal commands
  // --------------------------------------------------------------------------

  // Main "zap" terminal command
  const terminalZapDisposable = api.terminal.registerCommand('zap', async (ctx) => {
    const { args, cwd, write } = ctx;
    const count = parseInt(args[0]) || 3;

    write('\x1b[33m'); // Yellow
    write('⚡🐰 Electrobun Terminal Command\r\n');
    write('\x1b[0m');
    write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n\r\n');
    write(`\x1b[90mCWD: ${cwd}\x1b[0m\r\n\r\n`);

    const emojis = ['⚡', '🐰', '⚡🐰', '🔌', '💡', '🚀'];
    for (let i = 0; i < count; i++) {
      await new Promise(resolve => setTimeout(resolve, 150));
      const emoji = emojis[i % emojis.length];
      write(`${emoji} Zap ${i + 1}!\r\n`);
    }

    write('\r\n\x1b[32m✓ Electrobun zapped!\x1b[0m\r\n');
  });
  disposables.push(terminalZapDisposable);

  // "bunny" terminal command - shows bunny art
  const terminalBunnyDisposable = api.terminal.registerCommand('bunny', async (ctx) => {
    const { write } = ctx;
    write('\x1b[35m'); // Magenta
    write('   /)  /)\r\n');
    write('  ( ^.^ )\r\n');
    write('  c(")(")  \x1b[33m⚡ Electrobun!\x1b[0m\r\n\r\n');
  });
  disposables.push(terminalBunnyDisposable);

  // "paths" terminal command - shows bundled binary paths
  const terminalPathsDisposable = api.terminal.registerCommand('paths', async (ctx) => {
    const { write } = ctx;
    write('\x1b[36m⚡ Bundled Binary Paths:\x1b[0m\r\n\r\n');
    write(`  bun:       ${api.paths.bun}\r\n`);
    write(`  git:       ${api.paths.git}\r\n`);
    write(`  fd:        ${api.paths.fd}\r\n`);
    write(`  rg:        ${api.paths.rg}\r\n`);
    write(`  colabHome: ${api.paths.colabHome}\r\n`);
    write(`  plugins:   ${api.paths.plugins}\r\n\r\n`);
  });
  disposables.push(terminalPathsDisposable);

  api.log.info('✓ Terminal commands registered (zap, bunny, paths)');

  // --------------------------------------------------------------------------
  // 4. EDITOR: Register completion provider
  // --------------------------------------------------------------------------

  const completionDisposable = api.editor.registerCompletionProvider(
    ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
    {
      triggerCharacters: ['.'],
      provideCompletions(ctx) {
        if (!ctx.linePrefix.endsWith('console.')) {
          return [];
        }

        return [
          {
            label: '⚡ log (zap)',
            insertText: "log('⚡ ', $1);$0",
            detail: 'Electrobun console.log',
            documentation: 'Insert a console.log with a lightning bolt prefix',
            kind: 'snippet',
          },
          {
            label: '🐰 log (bunny)',
            insertText: "log('🐰 ', $1);$0",
            detail: 'Bunny console.log',
            documentation: 'Insert a console.log with a bunny prefix',
            kind: 'snippet',
          },
          {
            label: '⚡🐰 log (electrobun)',
            insertText: "log('⚡🐰 ', $1);$0",
            detail: 'Full Electrobun console.log',
            documentation: 'Insert a console.log with electrobun prefix',
            kind: 'snippet',
          },
          {
            label: '🚀 warn (launch)',
            insertText: "warn('🚀 ', $1);$0",
            detail: 'Launch warning',
            documentation: 'Insert a console.warn with rocket prefix',
            kind: 'snippet',
          },
        ];
      },
    }
  );
  disposables.push(completionDisposable);
  api.log.info('✓ Editor completion provider registered');

  // --------------------------------------------------------------------------
  // 5. STATUS BAR: Create dynamic status item
  // --------------------------------------------------------------------------

  const statusBarItem = api.statusBar.createItem({
    id: 'electrobun-status',
    text: '⚡🐰 Electrobun',
    tooltip: 'Electrobun Demo Plugin (Cmd+Shift+Z to zap)',
    color: '#ffcc00',
    alignment: 'right',
    priority: 100,
  });
  disposables.push(statusBarItem);

  flashStatus = (message: string, duration: number = 3000) => {
    statusBarItem.update({ text: message, color: '#00ff00' });
    setTimeout(() => {
      statusBarItem.update({
        text: electrobunModeEnabled ? '⚡ ZAPPED!' : '⚡🐰 Electrobun',
        color: electrobunModeEnabled ? '#00ff00' : api.settings.get<string>('statusBarColor') || '#ffcc00',
      });
    }, duration);
  };

  // Periodic status updates
  const emojis = ['⚡', '🐰', '⚡🐰', '🔌', '💡'];
  let tick = 0;
  const statusInterval = setInterval(() => {
    tick++;
    const savedColor = api.settings.get<string>('statusBarColor') || '#ffcc00';
    if (electrobunModeEnabled) {
      statusBarItem.update({ text: `⚡ ZAPPED! (${tick})`, color: '#00ff00' });
    } else {
      const emoji = emojis[tick % emojis.length];
      statusBarItem.update({ text: `${emoji} Electrobun (${tick})`, color: savedColor });
    }
  }, 5000);
  disposables.push({ dispose: () => clearInterval(statusInterval) });

  api.log.info('✓ Status bar item created');

  // --------------------------------------------------------------------------
  // 6. FILE DECORATIONS: Mark files with badges
  // --------------------------------------------------------------------------

  const decorationDisposable = api.fileDecorations.registerProvider({
    provideDecoration(filePath) {
      // TypeScript files get a lightning bolt
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        return {
          badge: '⚡',
          badgeColor: '#ffcc00',
          tooltip: 'TypeScript file - electrified!',
        };
      }
      // JavaScript files get a bunny
      if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
        return {
          badge: '🐰',
          tooltip: 'JavaScript file - bunny approved!',
        };
      }
      // .bunny files get special treatment
      if (filePath.endsWith('.bunny')) {
        return {
          badge: '⚡🐰',
          badgeColor: '#ff6b6b',
          tooltip: 'Electrobun file!',
        };
      }
      return undefined;
    },
  });
  disposables.push(decorationDisposable);
  api.log.info('✓ File decoration provider registered');

  // --------------------------------------------------------------------------
  // 7. CONTEXT MENU: Add menu items
  // --------------------------------------------------------------------------

  const contextMenuDisposable = api.contextMenu.registerItem(
    {
      id: 'electrify-file',
      label: '⚡ Electrify this file',
      context: 'both',
      shortcutHint: 'Cmd+Shift+E',
    },
    async (ctx) => {
      api.log.info(`Electrify requested for: ${ctx.filePath || 'selection'}`);

      // Demo: if it's a file, try to read it and show stats in status bar
      if (ctx.filePath) {
        try {
          const exists = await api.workspace.exists(ctx.filePath);
          if (exists) {
            const content = await api.workspace.readFile(ctx.filePath);
            const lines = content.split('\n').length;
            const chars = content.length;
            const fileName = ctx.filePath.split('/').pop() || 'file';

            // Flash the stats in the status bar
            flashStatus(`⚡ ${fileName}: ${lines} lines, ${chars} chars`, 4000);
            api.log.info(`File has ${chars} characters, ${lines} lines`);
          } else {
            flashStatus(`⚡ File not found`, 2000);
          }
        } catch (err) {
          api.log.warn(`Could not read file: ${err}`);
          flashStatus(`⚡ Error reading file`, 2000);
        }
      } else if (ctx.selection) {
        // Show selection stats
        const chars = ctx.selection.length;
        flashStatus(`⚡ Selection: ${chars} chars`, 3000);
      } else {
        flashStatus(`⚡ Nothing selected`, 2000);
      }
    }
  );
  disposables.push(contextMenuDisposable);

  // Context menu item to create a .bunny file
  const createBunnyDisposable = api.contextMenu.registerItem(
    {
      id: 'create-bunny-file',
      label: '🐰 Create .bunny file',
      context: 'fileTree',
    },
    async (ctx) => {
      // Get the directory path - if a file is selected, use its parent directory
      let dirPath = ctx.filePath || '';

      if (dirPath) {
        // Use shell to check if it's a directory
        try {
          const result = await api.shell.exec(`test -d "${dirPath}" && echo "dir" || echo "file"`);
          const isDir = result.stdout.trim() === 'dir';
          if (!isDir) {
            // It's a file, get the parent directory
            dirPath = dirPath.substring(0, dirPath.lastIndexOf('/'));
          }
        } catch {
          // If shell fails, fall back to extension check
          if (dirPath.includes('.') && !dirPath.endsWith('/')) {
            dirPath = dirPath.substring(0, dirPath.lastIndexOf('/'));
          }
        }
      }

      if (!dirPath) {
        const folders = await api.workspace.getWorkspaceFolders();
        if (folders.length > 0) {
          dirPath = folders[0].path;
        }
      }

      if (!dirPath) {
        api.notifications.showError('No directory selected');
        return;
      }

      // Get a unique filename
      const fileName = api.utils.getUniqueNewName(dirPath, 'hello.bunny');
      const filePath = `${dirPath}/${fileName}`;

      // Create the file with some default content
      const content = `🐰 Welcome to your bunny file!

This is a demo of the Electrobun plugin's custom slate feature.
Edit this content and see it rendered in the Bunny Viewer.

⚡ Fun bunny facts:
- Bunnies can hop up to 3 feet high!
- A group of bunnies is called a fluffle.
- Bunnies have nearly 360-degree vision.

Created: ${new Date().toLocaleString()}
`;

      try {
        await api.workspace.writeFile(filePath, content);
        flashStatus(`🐰 Created ${fileName}`, 3000);
        api.log.info(`Created bunny file: ${filePath}`);
      } catch (err) {
        api.notifications.showError(`Failed to create file: ${err}`);
        api.log.error(`Failed to create bunny file: ${err}`);
      }
    }
  );
  disposables.push(createBunnyDisposable);

  api.log.info('✓ Context menu items registered');

  // --------------------------------------------------------------------------
  // 8. KEYBINDINGS: Register keyboard shortcuts
  // --------------------------------------------------------------------------

  const keybindingDisposable = api.keybindings.register({
    key: 'cmd+shift+z',
    command: 'electrobun.zap',
    when: 'global',
  });
  disposables.push(keybindingDisposable);
  api.log.info('✓ Keyboard shortcut registered (Cmd+Shift+Z)');

  // --------------------------------------------------------------------------
  // 9. SETTINGS: Register settings schema
  // --------------------------------------------------------------------------

  const settingsDisposable = api.settings.registerSchema({
    title: '⚡🐰 Electrobun Settings',
    description: 'Configure the Electrobun Demo Plugin',
    fields: [
      {
        key: 'autoZap',
        label: 'Auto-Zap on Load',
        type: 'boolean',
        default: false,
        description: 'Automatically enable electrobun mode when the plugin loads',
      },
      {
        key: 'zapCount',
        label: 'Default Zap Count',
        type: 'number',
        default: 3,
        min: 1,
        max: 20,
        step: 1,
        description: 'Default number of zaps for the terminal command',
      },
      {
        key: 'statusBarColor',
        label: 'Status Bar Color',
        type: 'color',
        default: '#ffcc00',
        description: 'Color for the electrobun status bar indicator',
      },
      {
        key: 'bunnyStyle',
        label: 'Bunny Style',
        type: 'select',
        default: 'cute',
        description: 'Choose your preferred bunny aesthetic',
        options: [
          { label: '🐰 Cute', value: 'cute' },
          { label: '🐇 Classic', value: 'classic' },
          { label: '⚡🐰 Electrified', value: 'electrified' },
        ],
      },
      {
        key: 'secretToken',
        label: 'Demo Secret Token',
        type: 'secret',
        placeholder: 'Enter a secret token (demo only)',
        description: 'This demonstrates the secret field type - masked input',
      },
    ],
  });
  disposables.push(settingsDisposable);

  // Listen for settings changes
  const settingsChangeDisposable = api.settings.onChange((key, value) => {
    api.log.info(`Setting changed: ${key} = ${value}`);

    if (key === 'statusBarColor') {
      statusBarItem.update({ color: value as string });
    }

    if (key === 'autoZap' && value === true && !electrobunModeEnabled) {
      electrobunModeEnabled = true;
      flashStatus('⚡ Auto-zapped!', 2000);
    }
  });
  disposables.push(settingsChangeDisposable);

  // Check auto-zap setting
  const autoZap = api.settings.get<boolean>('autoZap');
  if (autoZap) {
    electrobunModeEnabled = true;
    statusBarItem.update({ text: '⚡ ZAPPED!', color: '#00ff00' });
  }

  api.log.info('✓ Settings schema registered');

  // --------------------------------------------------------------------------
  // 10. STATE: Demo arbitrary state storage
  // --------------------------------------------------------------------------

  // Initialize or increment load count
  const loadCount = (api.state.get<number>('loadCount') || 0) + 1;
  api.state.set('loadCount', loadCount);
  api.state.set('lastLoadTime', new Date().toISOString());
  api.state.set('bunnyFacts', [
    'Bunnies can hop up to 3 feet high!',
    'A group of bunnies is called a fluffle.',
    'Bunnies have nearly 360-degree vision.',
  ]);

  api.log.info(`✓ State initialized (load #${loadCount})`);
  api.log.info('State contents:', api.state.getAll());

  // --------------------------------------------------------------------------
  // 11. EVENTS: Subscribe to file and editor changes
  // --------------------------------------------------------------------------

  const fileChangeDisposable = api.events.onFileChange((event) => {
    api.log.debug(`File ${event.type}: ${event.path}`);
    // Demo: track changed files in state
    const changedFiles = api.state.get<string[]>('changedFiles') || [];
    if (!changedFiles.includes(event.path)) {
      changedFiles.push(event.path);
      if (changedFiles.length > 10) changedFiles.shift(); // Keep last 10
      api.state.set('changedFiles', changedFiles);
    }
  });
  disposables.push(fileChangeDisposable);

  const editorChangeDisposable = api.events.onActiveEditorChange((editor) => {
    if (editor) {
      api.log.debug(`Active editor changed: ${editor.path} (${editor.languageId})`);
    } else {
      api.log.debug('No active editor');
    }
  });
  disposables.push(editorChangeDisposable);

  api.log.info('✓ Event subscriptions registered');

  // --------------------------------------------------------------------------
  // 12. SLATES: Register custom file handler for .bunny files
  // --------------------------------------------------------------------------

  const slateDisposable = api.slates.register({
    id: 'bunny-viewer',
    name: 'Bunny Viewer',
    description: 'A custom viewer for .bunny files',
    icon: '🐰',
    patterns: ['*.bunny', '**/*.bunny'],
  });
  disposables.push(slateDisposable);

  // Handle slate mount
  const slateMountDisposable = api.slates.onMount('bunny-viewer', async (context) => {
    api.log.info(`Bunny slate mounting for: ${context.filePath}`);

    // Store the file path for this instance so we can access it in event handlers
    const instances = api.state.get<Record<string, string>>('slateInstances') || {};
    instances[context.instanceId] = context.filePath;
    api.state.set('slateInstances', instances);

    // Get the directory of the .bunny file for the terminal cwd
    const fileDir = context.filePath.substring(0, context.filePath.lastIndexOf('/'));

    // Read the file content if it exists
    let content = '';
    try {
      content = await api.workspace.readFile(context.filePath);
    } catch (err) {
      content = '(new bunny file)';
    }

    // Escape content for HTML
    const escapedContent = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Render the slate UI with terminal
    const html = `
      <div style="font-family: system-ui, sans-serif; padding: 24px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100%; color: #eee;">
        <div style="max-width: 800px; margin: 0 auto;">
          <h1 style="color: #ffcc00; margin-bottom: 8px;">⚡🐰 Bunny File Viewer</h1>
          <p style="color: #888; margin-bottom: 24px;">Viewing: ${context.filePath}</p>

          <div style="background: #0f0f1a; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <pre id="file-content" style="margin: 0; white-space: pre-wrap; color: #a0a0a0;">${escapedContent || '(empty)'}</pre>
          </div>

          <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 24px;">
            <button id="update-btn" style="background: #ffcc00; color: #000; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: transform 0.1s;">
              ✏️ Update file
            </button>
            <button id="cat-btn" style="background: #e91e63; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: transform 0.1s;">
              🐰 Cat file
            </button>
            <button id="top-btn" style="background: #2196F3; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: transform 0.1s;">
              📊 Run top
            </button>
            <span id="status-msg" style="margin-left: 12px; color: #888; font-size: 14px;"></span>
          </div>

          <div style="margin-bottom: 24px;">
            <h3 style="color: #ffcc00; margin-bottom: 12px;">⚡ Terminal</h3>
            <div style="height: 300px; border-radius: 8px; overflow: hidden;">
              <colab-terminal id="bunny-terminal" cwd="${fileDir}" style="width: 100%; height: 100%;"></colab-terminal>
            </div>
          </div>

          <div style="padding: 16px; background: rgba(255,204,0,0.1); border-radius: 8px; border-left: 4px solid #ffcc00;">
            <strong style="color: #ffcc00;">🐰 Bunny Fact:</strong>
            <p style="margin: 8px 0 0 0; color: #ccc;">
              ${(api.state.get<string[]>('bunnyFacts') || ['Bunnies are awesome!'])[Math.floor(Math.random() * 3)]}
            </p>
          </div>
        </div>
      </div>
    `;

    const script = `
      var statusMsg = getElementById('status-msg');
      var updateBtn = getElementById('update-btn');
      var catBtn = getElementById('cat-btn');
      var topBtn = getElementById('top-btn');
      var fileContent = getElementById('file-content');
      var terminal = getElementById('bunny-terminal');
      var filePath = '${context.filePath}';

      function showStatus(msg, color) {
        statusMsg.textContent = msg;
        statusMsg.style.color = color || '#00ff00';
        setTimeout(function() { statusMsg.textContent = ''; }, 3000);
      }

      function animateButton(btn) {
        btn.style.transform = 'scale(0.95)';
        setTimeout(function() { btn.style.transform = 'scale(1)'; }, 100);
      }

      // Wait for terminal to be ready before running commands
      terminal.addEventListener('terminal-ready', function() {
        console.log('Bunny terminal ready!');
      });

      updateBtn.addEventListener('click', function() {
        animateButton(updateBtn);
        showStatus('Updating file...', '#ffcc00');
        // Send event to plugin to append to file using workspace API
        window.colabSlate.sendEvent('appendToFile', { timestamp: new Date().toISOString() });
      });

      catBtn.addEventListener('click', function() {
        animateButton(catBtn);
        showStatus('Reading file...', '#e91e63');
        // Use single quotes to avoid shell escaping issues
        terminal.run("cat '" + filePath + "'");
      });

      topBtn.addEventListener('click', function() {
        animateButton(topBtn);
        showStatus('Running top (press q to quit)...', '#2196F3');
        terminal.run('top');
      });
    `;

    api.slates.render(context.instanceId, html, script);
  });
  disposables.push(slateMountDisposable);

  // Handle slate unmount
  const slateUnmountDisposable = api.slates.onUnmount('bunny-viewer', (instanceId) => {
    api.log.info(`Bunny slate unmounting: ${instanceId}`);

    // Clean up the stored file path
    const instances = api.state.get<Record<string, string>>('slateInstances') || {};
    delete instances[instanceId];
    api.state.set('slateInstances', instances);
  });
  disposables.push(slateUnmountDisposable);

  // Handle slate events
  const slateEventDisposable = api.slates.onEvent('bunny-viewer', async (instanceId, eventType, payload) => {
    api.log.info(`Bunny slate event: ${eventType}`, payload);

    if (eventType === 'appendToFile') {
      const p = payload as { timestamp: string };
      // Get the file path from the active instance
      const instance = api.state.get<Record<string, string>>('slateInstances') || {};
      const filePath = instance[instanceId];

      if (filePath) {
        try {
          // Read current content
          let content = '';
          try {
            content = await api.workspace.readFile(filePath);
          } catch {
            content = '';
          }

          // Append new line with timestamp
          const newLine = `\n⚡ Zapped at ${new Date(p.timestamp).toLocaleString()}`;
          const newContent = content + newLine;

          // Write back
          await api.workspace.writeFile(filePath, newContent);
          api.log.info(`Appended to file: ${filePath}`);

          // Re-render the slate with updated content
          const escapedContent = newContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

          // Send a message to update just the file preview (we'd need to re-render for this)
          // For now, just log success
          api.log.info('File updated successfully!');
        } catch (err) {
          api.log.error(`Failed to append to file: ${err}`);
        }
      }
    }
  });
  disposables.push(slateEventDisposable);

  api.log.info('✓ Slate registered for .bunny files');

  // --------------------------------------------------------------------------
  // 13. PATHS: Log available paths (for demo purposes)
  // --------------------------------------------------------------------------

  api.log.info('Bundled paths available:', {
    bun: api.paths.bun,
    git: api.paths.git,
    fd: api.paths.fd,
    rg: api.paths.rg,
    colabHome: api.paths.colabHome,
    plugins: api.paths.plugins,
  });

  // --------------------------------------------------------------------------
  // Done!
  // --------------------------------------------------------------------------

  api.log.info('⚡🐰 Electrobun Demo Plugin activated! All features registered.');
  api.log.info('Try these commands:');
  api.log.info('  - Terminal: zap, bunny, paths');
  api.log.info('  - Keyboard: Cmd+Shift+Z');
  api.log.info('  - Create a .bunny file to see the custom slate');
}

// ============================================================================
// Plugin Deactivation
// ============================================================================

export async function deactivate(): Promise<void> {
  for (const disposable of disposables) {
    disposable.dispose();
  }
  disposables.length = 0;
  electrobunModeEnabled = false;
}
