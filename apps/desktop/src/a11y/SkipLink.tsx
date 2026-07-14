// apps/desktop/src/a11y/SkipLink.tsx
// Skip-link component. Renders as the first child of <body> so screen-reader
// and keyboard users can jump past nav to <main id="main">. Visually hidden
// until focused (sr-only pattern in tokens.css).

import type { Component } from "solid-js";

export const SkipLink: Component<{ href?: string; label?: string }> = (
  props,
) => {
  const href = () => props.href ?? "#main";
  const label = () => props.label ?? "Skip to main content";
  return (
    <a class="skip-link" href={href()}>
      {label()}
    </a>
  );
};
