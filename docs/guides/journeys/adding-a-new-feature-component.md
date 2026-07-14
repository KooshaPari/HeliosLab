# Journey: Adding a New Feature Component

**Journey ID:** JOURNEY-002  
**Project:** heliosApp  
**Tier:** DEEP  
**Last Updated:** 2026-04-04

---

## Overview

This journey guides developers through adding a new feature component to heliosApp. We will implement a "Terminal Themer" component that allows users to customize terminal colors per lane.

**Prerequisites:**
- Completed [Setting Up heliosApp Development](./setting-up-heliosapp-development.md)
- Understanding of SolidJS signals
- Familiarity with the LocalBus protocol

**Estimated Time:** 30-45 minutes

---

## Feature Specification

### Terminal Themer Requirements

1. **Per-lane color schemes:** Each lane can have a custom terminal theme
2. **Preset themes:** Catppuccin, Dracula, Monokai, Nord, Solarized
3. **Custom themes:** User-defined ANSI color mappings
4. **Live preview:** Changes apply immediately to terminal output
5. **Persistence:** Theme preferences saved to workspace settings

### Data Model

```typescript
interface TerminalTheme {
  id: string;
  name: string;
  author?: string;
  colors: {
    foreground: string;
    background: string;
    cursor: string;
    ansi: {
      black: string;
      red: string;
      green: string;
      yellow: string;
      blue: string;
      magenta: string;
      cyan: string;
      white: string;
      brightBlack: string;
      brightRed: string;
      brightGreen: string;
      brightYellow: string;
      brightBlue: string;
      brightMagenta: string;
      brightCyan: string;
      brightWhite: string;
    };
  };
}
```

---

## Step 1: Create the Component Structure

Navigate to the renderer components directory:

```bash
ls apps/renderer/src/components/
```

Create a new directory for the themer:

```bash
mkdir -p apps/renderer/src/components/themer
```

### Component Files

```
themer/
├── index.ts           # Public exports
├── ThemerPanel.tsx    # Main panel component
├── ThemeSelector.tsx  # Theme dropdown
├── ColorPicker.tsx   # Custom color editor
├── Preview.tsx        # Live terminal preview
└── types.ts           # TypeScript interfaces
```

---

## Step 2: Define Types

Create `types.ts`:

```typescript
import type { JSX } from 'solid-js';

export interface TerminalTheme {
  id: string;
  name: string;
  author?: string;
  colors: ThemeColors;
}

export interface ThemeColors {
  foreground: string;
  background: string;
  cursor: string;
  ansi: AnsiColors;
}

export interface AnsiColors {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemerProps {
  laneId: string;
  onThemeChange?: (theme: TerminalTheme) => void;
}

export type ThemePreset = 'catppuccin' | 'dracula' | 'monokai' | 'nord' | 'solarized';
```

---

## Step 3: Implement Preset Themes

Create `presets.ts`:

```typescript
import type { TerminalTheme } from './types';

export const THEME_PRESETS: Record<string, TerminalTheme> = {
  catppuccin: {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    author: 'Catppuccin Community',
    colors: {
      foreground: '#cdd6f4',
      background: '#1e1e2e',
      cursor: '#f5e0dc',
      ansi: {
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
    },
  },

  dracula: {
    id: 'dracula-official',
    name: 'Dracula',
    author: 'Dracula Theme',
    colors: {
      foreground: '#f8f8f2',
      background: '#282a36',
      cursor: '#f8f8f0',
      ansi: {
        black: '#21222c',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#6272a4',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff',
      },
    },
  },

  monokai: {
    id: 'monokai-pro',
    name: 'Monokai Pro',
    author: 'Monokai',
    colors: {
      foreground: '#f2f2f2',
      background: '#2D2A2E',
      cursor: '#FCFCFA',
      ansi: {
        black: '#403E41',
        red: '#F92672',
        green: '#A6E22E',
        yellow: '#FD971F',
        blue: '#66D9EF',
        magenta: '#AE81FF',
        cyan: '#A1EFE4',
        white: '#F8F8F2',
        brightBlack: '#727072',
        brightRed: '#F92672',
        brightGreen: '#A6E22E',
        brightYellow: '#FD971F',
        brightBlue: '#66D9EF',
        brightMagenta: '#AE81FF',
        brightCyan: '#A1EFE4',
        brightWhite: '#F9F8F5',
      },
    },
  },

  nord: {
    id: 'nord-official',
    name: 'Nord',
    author: 'Nord Theme',
    colors: {
      foreground: '#ECEFF4',
      background: '#2E3440',
      cursor: '#D8DEE9',
      ansi: {
        black: '#3B4252',
        red: '#BF616A',
        green: '#A3BE8C',
        yellow: '#EBCB8B',
        blue: '#81A1C1',
        magenta: '#B48EAD',
        cyan: '#8FBCBB',
        white: '#E5E9F0',
        brightBlack: '#4C566A',
        brightRed: '#BF616A',
        brightGreen: '#A3BE8C',
        brightYellow: '#EBCB8B',
        brightBlue: '#81A1C1',
        brightMagenta: '#B48EAD',
        brightCyan: '#8FBCBB',
        brightWhite: '#ECEFF4',
      },
    },
  },

  solarized: {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    author: 'Ethan Schoonover',
    colors: {
      foreground: '#839496',
      background: '#002b36',
      cursor: '#D33682',
      ansi: {
        black: '#073642',
        red: '#DC322F',
        green: '#859900',
        yellow: '#B58900',
        blue: '#268BD2',
        magenta: '#D33682',
        cyan: '#2AA198',
        white: '#EEE8D5',
        brightBlack: '#586E75',
        brightRed: '#CB4B16',
        brightGreen: '#586E75',
        brightYellow: '#657B83',
        brightBlue: '#00BFFF',
        brightMagenta: '#6C71C4',
        brightCyan: '#93A1A1',
        brightWhite: '#FDF6E3',
      },
    },
  },
};
```

---

## Step 4: Implement the ThemerPanel Component

Create `ThemerPanel.tsx`:

```typescript
import { createSignal, createEffect, For, Show } from 'solid-js';
import type { TerminalTheme, ThemePreset, ThemerProps } from './types';
import { THEME_PRESETS } from './presets';
import { ThemeSelector } from './ThemeSelector';
import { ColorPicker } from './ColorPicker';
import { Preview } from './Preview';

export function ThemerPanel(props: ThemerProps) {
  const [selectedPreset, setSelectedPreset] = createSignal<ThemePreset>('nord');
  const [currentTheme, setCurrentTheme] = createSignal<TerminalTheme>(
    THEME_PRESETS['nord']
  );
  const [customColors, setCustomColors] = createSignal(false);

  // Sync theme to LocalBus when changed
  createEffect(() => {
    const theme = currentTheme();
    
    // Publish theme change event to LocalBus
    bus.publish({
      id: generateId(),
      type: 'event',
      topic: 'terminal.theme_changed',
      payload: {
        lane_id: props.laneId,
        theme_id: theme.id,
        colors: theme.colors,
      },
      context: { lane_id: props.laneId },
      timestamp: Date.now(),
      sequence: bus.getNextSequence('terminal.theme_changed'),
    });

    props.onThemeChange?.(theme);
  });

  const handlePresetSelect = (preset: ThemePreset) => {
    setSelectedPreset(preset);
    setCurrentTheme(THEME_PRESETS[preset]);
    setCustomColors(false);
  };

  const handleCustomColorChange = (key: string, value: string) => {
    if (!customColors()) {
      // Clone current theme to start customizing
      setCurrentTheme(prev => ({
        ...prev,
        id: 'custom',
        name: 'Custom Theme',
        colors: { ...prev.colors },
      }));
      setCustomColors(true);
    }

    setCurrentTheme(prev => ({
      ...prev,
      colors: {
        ...prev.colors,
        [key]: value,
      },
    }));
  };

  return (
    <div class="themer-panel">
      <header class="themer-header">
        <h2>Terminal Themer</h2>
        <span class="lane-badge">{props.laneId}</span>
      </header>

      <ThemeSelector
        presets={THEME_PRESETS}
        selected={selectedPreset()}
        onSelect={handlePresetSelect}
      />

      <Show when={customColors()}>
        <ColorPicker
          theme={currentTheme()}
          onColorChange={handleCustomColorChange}
        />
      </Show>

      <Preview theme={currentTheme()} />

      <footer class="themer-footer">
        <span class="theme-name">{currentTheme().name}</span>
        <Show when={currentTheme().author}>
          <span class="theme-author">by {currentTheme().author}</span>
        </Show>
      </footer>
    </div>
  );
}

function generateId(): string {
  return `env_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
```

---

## Step 5: Implement ThemeSelector

Create `ThemeSelector.tsx`:

```typescript
import { For } from 'solid-js';
import type { TerminalTheme, ThemePreset } from './types';

interface ThemeSelectorProps {
  presets: Record<string, TerminalTheme>;
  selected: ThemePreset;
  onSelect: (preset: ThemePreset) => void;
}

export function ThemeSelector(props: ThemeSelectorProps) {
  return (
    <div class="theme-selector">
      <label class="selector-label">Theme Presets</label>
      <div class="theme-grid">
        <For each={Object.entries(props.presets)}>
          {([key, theme]) => (
            <button
              class="theme-card"
              classList={{ selected: props.selected === key }}
              onClick={() => props.onSelect(key as ThemePreset)}
              style={{
                '--theme-bg': theme.colors.background,
                '--theme-fg': theme.colors.foreground,
              }}
            >
              <div class="theme-preview">
                <div class="preview-row bg-black" />
                <div class="preview-row bg-red" />
                <div class="preview-row bg-green" />
                <div class="preview-row bg-yellow" />
                <div class="preview-row bg-blue" />
              </div>
              <span class="theme-name">{theme.name}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
```

---

## Step 6: Implement ColorPicker

Create `ColorPicker.tsx`:

```typescript
import { For } from 'solid-js';
import type { TerminalTheme } from './types';

interface ColorPickerProps {
  theme: TerminalTheme;
  onColorChange: (key: string, value: string) => void;
}

const COLOR_KEYS = [
  'foreground',
  'background', 
  'cursor',
  'ansi.black',
  'ansi.red',
  'ansi.green',
  'ansi.yellow',
  'ansi.blue',
  'ansi.magenta',
  'ansi.cyan',
  'ansi.white',
] as const;

export function ColorPicker(props: ColorPickerProps) {
  const getColor = (key: string): string => {
    if (key.startsWith('ansi.')) {
      const ansiKey = key.replace('ansi.', '');
      return (props.theme.colors.ansi as Record<string, string>)[ansiKey];
    }
    return (props.theme.colors as Record<string, string>)[key];
  };

  return (
    <div class="color-picker">
      <label class="picker-label">Customize Colors</label>
      <div class="color-grid">
        <For each={COLOR_KEYS}>
          {(key) => (
            <div class="color-item">
              <input
                type="color"
                value={getColor(key)}
                onInput={(e) => props.onColorChange(key, e.currentTarget.value)}
                class="color-input"
              />
              <span class="color-label">{key}</span>
              <span class="color-value">{getColor(key)}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
```

---

## Step 7: Implement Preview

Create `Preview.tsx`:

```typescript
import type { TerminalTheme } from './types';

interface PreviewProps {
  theme: TerminalTheme;
}

export function Preview(props: PreviewProps) {
  const styles = () => ({
    '--fg': props.theme.colors.foreground,
    '--bg': props.theme.colors.background,
    '--cursor': props.theme.colors.cursor,
    '--black': props.theme.colors.ansi.black,
    '--red': props.theme.colors.ansi.red,
    '--green': props.theme.colors.ansi.green,
    '--yellow': props.theme.colors.ansi.yellow,
    '--blue': props.theme.colors.ansi.blue,
    '--magenta': props.theme.colors.ansi.magenta,
    '--cyan': props.theme.colors.ansi.cyan,
    '--white': props.theme.colors.ansi.white,
  });

  return (
    <div class="theme-preview-panel" style={styles()}>
      <div class="preview-terminal">
        <div class="preview-titlebar">
          <span class="preview-dot" style={{ background: 'var(--red)' }} />
          <span class="preview-dot" style={{ background: 'var(--yellow)' }} />
          <span class="preview-dot" style={{ background: 'var(--green)' }} />
          <span class="preview-title">preview</span>
        </div>
        <div class="preview-content">
          <p style={{ color: 'var(--green)' }}>~/projects/helios