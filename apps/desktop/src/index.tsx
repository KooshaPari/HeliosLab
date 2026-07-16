// apps/desktop/src/index.tsx
// Desktop entry — wraps the app in <DirProvider> and mounts a singleton
// live region for status announcements. The SkipLink is the first
// focusable element on every route (verified in e2e/a11y/skip-link.spec.ts).

import { type Component, onCleanup, onMount } from "solid-js";
import { SkipLink } from "./a11y/SkipLink.js";
import { DirProvider } from "./a11y/DirProvider.js";
import { getAnnouncer } from "../../../packages/runtime-core/src/a11y/announce.js";
import { AgentTab } from "./tabs/agent_tab.js";
import { ChatTab } from "./tabs/chat_tab.js";
import { ProjectTab } from "./tabs/project_tab.js";
import { SessionTab } from "./tabs/session_tab.js";
import { TabBar } from "./tabs/tab_bar.js";
import type { TabSurface } from "./tabs/tab_surface.js";
import { TerminalTab } from "./tabs/terminal_tab.js";

export const App: Component = () => {
  let tabHost: HTMLElement | undefined;

  onMount(() => {
    // Mount the live regions so store-driven announcements land somewhere.
    getAnnouncer();

    if (!tabHost) return;

    const surfaces: TabSurface[] = [
      new TerminalTab(),
      new AgentTab(),
      new SessionTab(),
      new ChatTab(),
      new ProjectTab(),
    ];
    const panels = new Map<string, HTMLElement>();
    const panelHost = document.createElement("div");
    panelHost.className = "tab-surfaces";

    for (const surface of surfaces) {
      const panel = document.createElement("section");
      panel.id = `tab-panel-${surface.getTabId()}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `tab-trigger-${surface.getTabId()}`);
      panel.setAttribute("data-tab-surface", surface.getTabType());
      panel.appendChild(surface.renderWithErrorBoundary());
      panels.set(surface.getTabId(), panel);
      panelHost.appendChild(panel);
    }

    const selectSurface = (tabId: string): void => {
      for (const surface of surfaces) {
        const selected = surface.getTabId() === tabId;
        panels.get(surface.getTabId())!.hidden = !selected;
        const trigger = tabHost?.querySelector(`[data-tab-id="${surface.getTabId()}"]`);
        trigger?.setAttribute("aria-selected", String(selected));
      }
    };
    const tabBar = new TabBar(surfaces, { onTabSelected: selectSurface });
    tabHost.replaceChildren(tabBar.render(), panelHost);
    selectSurface(tabBar.getSelectedTabId() ?? surfaces[0]!.getTabId());

    onCleanup(() => {
      for (const surface of surfaces) surface.destroy();
    });
  });

  return (
    <DirProvider>
      <SkipLink />
      <header role="banner" aria-label="App header">
        {/* Header chrome — file tree toggle, search, settings */}
      </header>
      <nav aria-label="Primary">
        {/* Primary navigation */}
      </nav>
      <main id="main" tabindex="-1" role="main">
        <section
          ref={(element) => {
            tabHost = element;
          }}
          aria-label="Workspace tab surfaces"
        />
      </main>
      <aside aria-label="Secondary">
        {/* File tree, secondary panels */}
      </aside>
      <footer role="contentinfo">
        {/* Status bar */}
      </footer>
    </DirProvider>
  );
};

export default App;
