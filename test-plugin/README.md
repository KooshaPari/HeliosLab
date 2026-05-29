# Electrobun Demo Plugin

A comprehensive demo plugin that showcases the full Colab plugin API surface. This plugin is designed for testing, QA, and as a reference implementation for plugin developers.

## Installation

### From npm (via Colab UI)

1. Click on **Plugins** in the Colab status bar
2. In the **Browse** tab, search for "electrobun-demo"
3. Click **Install** on the plugin

Colab discovers plugins on npm by searching for packages with the `colab-plugin` keyword.

### From a local folder (for development)

1. Click on **Plugins** in the Colab status bar
2. Click **Install from folder**
3. Select the `test-plugin` directory

Local plugins are symlinked, so changes take effect after restarting Colab.

## What This Plugin Demonstrates

### Commands
- `electrobun.zap` - Enable "zapped" mode
- `electrobun.rest` - Disable zapped mode
- `electrobun.showGitStatus` - Display git branch and status
- `electrobun.findFiles` - Find TypeScript files in workspace
- `electrobun.runShell` - Execute a shell command
- `electrobun.openDocs` - Open Electrobun documentation

### Terminal Commands
Type these in any Colab terminal:
- `zap [count]` - Display zap animations
- `bunny` - Show ASCII bunny art
- `paths` - Show bundled binary paths (bun, git, fd, rg)

### Keyboard Shortcuts
- `Cmd+Shift+Z` - Trigger the zap command

### Context Menu
Right-click in the file tree to see:
- **Electrify this file** - Shows file stats in status bar
- **Create .bunny file** - Creates a demo file that opens in a custom slate

### Custom Slate (.bunny files)
The plugin registers a custom file handler for `.bunny` files featuring:
- File content preview
- Embedded xterm.js terminal
- Buttons to update file, cat contents, and run `top`
- Demonstrates slate events and plugin-to-slate communication

### Editor Completions
In JavaScript/TypeScript files, type `console.` to see electrobun-themed completion snippets.

### File Decorations
- TypeScript files (.ts, .tsx) show a ⚡ badge
- JavaScript files (.js, .jsx) show a 🐰 badge
- Bunny files (.bunny) show a ⚡🐰 badge

### Status Bar
Dynamic status bar item showing plugin state with periodic updates.

### Settings
Open plugin settings to configure:
- Auto-zap on load
- Default zap count
- Status bar color
- Bunny style preference
- Demo secret token field

## Colab Plugin API Surface

This plugin exercises the following API namespaces:

| Namespace | Methods Used |
|-----------|--------------|
| `api.commands` | `registerCommand`, `executeCommand` |
| `api.webview` | `registerPreloadScript` |
| `api.workspace` | `readFile`, `writeFile`, `exists`, `findFiles`, `getWorkspaceFolders` |
| `api.editor` | `registerCompletionProvider` |
| `api.terminal` | `registerCommand` |
| `api.shell` | `exec` |
| `api.notifications` | `showInfo`, `showWarning`, `showError` |
| `api.log` | `debug`, `info`, `warn`, `error` |
| `api.git` | `getStatus`, `getBranch` |
| `api.events` | `onFileChange`, `onActiveEditorChange` |
| `api.statusBar` | `createItem` |
| `api.fileDecorations` | `registerProvider` |
| `api.contextMenu` | `registerItem` |
| `api.keybindings` | `register` |
| `api.settings` | `registerSchema`, `get`, `set`, `onChange` |
| `api.state` | `get`, `set`, `delete`, `getAll` |
| `api.slates` | `register`, `onMount`, `onUnmount`, `onEvent`, `render` |
| `api.paths` | `bun`, `git`, `fd`, `rg`, `colabHome`, `plugins` |
| `api.ui` | `openUrl` |
| `api.utils` | `getUniqueNewName` |
| `api.plugin` | `name`, `version` |

## Plugin Entitlements

Declared capabilities (informational for user trust):

```json
{
  "filesystem": { "read": true, "write": true },
  "network": { "internet": true },
  "process": { "spawn": true },
  "webview": { "scriptInjection": true },
  "terminal": { "commands": true },
  "ui": { "statusBar": true, "contextMenu": true, "fileDecorations": true, "notifications": true },
  "editor": { "completions": true },
  "keybindings": { "global": true }
}
```

## Development

This plugin lives in the Colab repository at `test-plugin/` and is used for:
- Testing the plugin infrastructure during development
- QA validation of plugin API features
- Reference implementation for plugin developers

To develop locally:

1. Install the plugin from the local folder (see Installation above)
2. Make changes to `index.ts`
3. Restart Colab to pick up changes (local plugins are symlinked)

## Publishing to npm

To make your plugin discoverable in Colab's plugin browser:

1. Add the `colab-plugin` keyword to your `package.json`:
   ```json
   {
     "keywords": ["colab-plugin"]
   }
   ```

2. Include the `colab-plugin` configuration field (see this plugin's `package.json` for a full example)

3. Publish to npm:
   ```bash
   npm publish
   ```

Users can then find and install your plugin directly from Colab's Plugins panel.

## Using the Terminal Web Component

Plugin slates can embed a full xterm.js terminal using the `<colab-terminal>` web component:

```html
<colab-terminal cwd="/path/to/dir" style="width: 100%; height: 300px;"></colab-terminal>
```

```javascript
const terminal = document.getElementById('my-terminal');
terminal.run('npm install');  // Run a command
terminal.write('y\n');        // Send raw input
terminal.clear();             // Clear screen
terminal.kill();              // Kill process
```

## License

MIT
