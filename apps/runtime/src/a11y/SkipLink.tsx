// apps/runtime/src/a11y/SkipLink.tsx
// Runtime-side skip-link. Mirrors apps/desktop/src/a11y/SkipLink.tsx so the
// two entry points can render the same first focusable element.

import type { Component } from "solid-js";

export const SkipLink: Component<{ href?: string; label?: string }> = props => {
  const href = () => props.href ?? "#main";
  const label = () => props.label ?? "Skip to main content";
  return (
    <a class="skip-link" href={href()}>
      {label()}
    </a>
  );
};
