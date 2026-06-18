/**
 * Monaco editor configuration with screen-reader accessibility enabled.
 *
 * `accessibilitySupport: 'on'` tells Monaco to expose semantic information
 * (line numbers, current line, cursor position, selection ranges) to screen
 * readers via aria-* attributes on its internal DOM. Without this, Monaco
 * renders as a flat `<div>` tree with no semantic structure.
 *
 * Note: tab inside the editor inserts a tab character (Monaco default). To
 * move keyboard focus OUT of the editor, use `Ctrl+M` (Monaco built-in) or
 * `Esc` to leave editor-embedded widgets. Documented in `src/docs/i18n.md`.
 */
import type { editor } from "monaco-editor";

export const ACCESSIBLE_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
	accessibilitySupport: "on",
	ariaLabel: "Code editor. Use arrow keys to navigate, type to edit.",
	tabFocusMode: false, // Tab inserts a tab character; Ctrl+M moves focus out
	formatOnPaste: false,
	automaticLayout: true,
	// Visual contrast — minimum 4.5:1 against #1e1e1e (the default theme bg)
	// is achieved by the dark+ token theme shipped with HeliosLab.
	theme: "vs-dark",
	fontSize: 14,
	lineNumbers: "on",
};
