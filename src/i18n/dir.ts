/**
 * RTL direction handling for HeliosLab.
 *
 * HeliosLab is a code editor. By design:
 *  - UI chrome (file tree, tabs, sidebar) mirrors in RTL.
 *  - Code content (Monaco, xterm, DiffEditor) stays LTR — code is universally
 *    read left-to-right even in RTL locales. This is the same design decision
 *    VS Code ships with.
 *
 * See `src/docs/i18n.md` for the full rationale and AT5 spec context.
 */

export type Dir = "ltr" | "rtl";

/**
 * Locales known to use right-to-left scripts. Extend as we add locale files.
 */
const RTL_LOCALE_CODES: ReadonlySet<string> = new Set(["ar", "he", "fa", "ur"]);

/** Derive document direction from a BCP-47 locale tag. */
export function dirFor(locale: string): Dir {
	const short = locale.toLowerCase().slice(0, 2);
	return RTL_LOCALE_CODES.has(short) ? "rtl" : "ltr";
}

/**
 * Apply the locale + direction to the <html> element. Safe to call repeatedly;
 * the work is idempotent.
 */
export function applyDocumentLocale(locale: string): void {
	if (typeof document === "undefined") return;
	const dir = dirFor(locale);
	document.documentElement.lang = locale;
	document.documentElement.dir = dir;
}
