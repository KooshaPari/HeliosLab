// apps/desktop/src/index.tsx
// Desktop entry — wraps the app in <DirProvider> and mounts a singleton
// live region for status announcements. The SkipLink is the first
// focusable element on every route (verified in e2e/a11y/skip-link.spec.ts).

import { type Component, onMount } from "solid-js";
import { SkipLink } from "./a11y/SkipLink.js";
import { DirProvider } from "./a11y/DirProvider.js";
import { getAnnouncer } from "../../../packages/runtime-core/src/a11y/announce.js";

export const App: Component = () => {
  onMount(() => {
    // Mount the live regions so store-driven announcements land somewhere.
    getAnnouncer();
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
        {/* Route content */}
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
