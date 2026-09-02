// axe-config.ts
// Shared axe-core configuration for heliosApp e2e accessibility tests.
// Mirrors the @axe-core/playwright tag set used across the Phenotype fleet
// (OmniRoute-3rd, HeliosLab, thegent) so per-app runs aggregate consistently.
//
// Rules to keep enabled across all 3 apps (desktop, runtime, colab-renderer):
//   - wcag2a, wcag2aa, wcag21a, wcag21aa: full WCAG 2.1 A + AA coverage
//   - color-contrast: surfaces token drift between light/dark themes
//   - region: catches orphaned content outside landmark regions
//
// Rules disabled for the colab-renderer surface (canvas/terminal heavy):
//   - bypass: a strict landmark-skip-link rule that fires inside xterm.js
//     shadow DOM and monaco's complex aria tree. Verified manually.
//   - scrollable-region-focusable: terminal scrollback is intentionally
//     arrow-keyed, not Tab-reachable; moving focus into the buffer would
//     steal keystrokes from the PTY.
//   - region: same reason as `bypass`; renderer chrome is non-semantic.

export const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
] as const;

export const AXE_RULES = {
  "color-contrast": { enabled: true },
  region: { enabled: true },
} as const;

export const COLAB_RENDERER_DISABLED_RULES = [
  "bypass",
  "scrollable-region-focusable",
  "region",
] as const;

export const APP_DISABLED_RULES: Record<string, readonly string[]> = {
  "apps/desktop": [],
  "apps/runtime": [],
  "apps/colab-renderer": COLAB_RENDERER_DISABLED_RULES,
};

export type AxeAppKey = keyof typeof APP_DISABLED_RULES;

export function disabledRulesFor(app: AxeAppKey): readonly string[] {
  return APP_DISABLED_RULES[app] ?? [];
}
