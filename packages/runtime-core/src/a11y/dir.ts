// packages/runtime-core/src/a11y/dir.ts
// Locale + dir handling for heliosApp. Single source of truth for which
// locales are RTL. Both apps/desktop and apps/runtime call
// `applyLocale(locale)` on mount; colab-renderer ignores dir (code editor
// surface is LTR-only, see spec AT5).

export type LocaleCode = "en" | "es" | "ar" | "he" | "fa" | "ur";
export type Direction = "ltr" | "rtl";

export const RTL_LOCALES: ReadonlySet<LocaleCode> = new Set([
  "ar",
  "he",
  "fa",
  "ur",
]);

export const SUPPORTED_LOCALES: ReadonlySet<LocaleCode> = new Set([
  "en",
  "es",
  "ar",
  "he",
  "fa",
  "ur",
]);

export function directionFor(locale: LocaleCode): Direction {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

export function applyLocale(locale: LocaleCode): void {
  if (typeof document === "undefined") return;
  const dir = directionFor(locale);
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.setAttribute("lang", locale);
  // Cookies are SSR-inert; only set on the client.
  document.cookie = `helios-locale=${locale};path=/;max-age=31536000;samesite=lax`;
}

export function readLocaleFromCookie(): LocaleCode {
  if (typeof document === "undefined") return "en";
  const match = /(?:^|;\s*)helios-locale=([a-z]{2})/.exec(document.cookie);
  const code = match?.[1] as LocaleCode | undefined;
  return code && SUPPORTED_LOCALES.has(code) ? code : "en";
}
