/**
 * i18n runtime for HeliosLab renderer.
 *
 * Uses @solid-primitives/i18n with createResource for async locale loading.
 * Falls back to English if a locale file fails to load or a key is missing.
 */
import { createMemo, createResource, type Accessor } from "solid-js";
import { I18nContext, type PrimitiveDict, flatten } from "@solid-primitives/i18n";
import enDict from "./en.json";
import esDict from "./es.json";

export type Locale = "en" | "es";

const dictionaries: Record<Locale, PrimitiveDict> = {
	en: flatten(enDict as unknown as Record<string, unknown>),
	es: flatten(esDict as unknown as Record<string, unknown>),
};

const STORAGE_KEY = "helioslab.locale";

/**
 * Detect initial locale from:
 *  1. localStorage (user override)
 *  2. navigator.language (first 2 chars)
 *  3. "en" (fallback)
 */
function detectLocale(): Locale {
	try {
		const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
		if (stored && (stored === "en" || stored === "es")) {
			return stored;
		}
	} catch {
		// localStorage unavailable (private mode, etc.) — fall through
	}
	const browser = typeof navigator !== "undefined" ? navigator.language : "en";
	const short = browser.toLowerCase().slice(0, 2);
	return short === "es" ? "es" : "en";
}

/**
 * Persist a locale change. Called by `setLocale`.
 */
export function setLocale(locale: Locale): void {
	try {
		localStorage.setItem(STORAGE_KEY, locale);
		document.documentElement.lang = locale;
	} catch {
		// best-effort
	}
}

/**
 * Create a reactive translator bound to a locale signal.
 *
 * Returns the I18nContext provider value to wrap a tree with, plus a `t` helper
 * for ad-hoc translation outside the context. Missing keys return the key
 * itself in development, or an empty string in production.
 */
export function createI18n(locale: Accessor<Locale>) {
	const dict = createMemo(() => dictionaries[locale()]);

	// Async resource gives createResource consumers a place to hook in (e.g. lazy
	// load JSON for languages not in the static import).
	const [resource] = createResource(locale, async (l) => dictionaries[l]);

	const t = (path: string, ...args: unknown[]): string => {
		const value = resource() ?? dict();
		// @solid-primitives/i18n flatten() joins nested keys with "."
		const resolved = value?.[path] ?? value?.[path.replace(/\./g, ".")];
		if (typeof resolved === "function") {
			// @ts-expect-error — function form takes args array
			return resolved(...args);
		}
		if (resolved == null) {
			if (import.meta.env?.DEV) {
				console.warn(`[i18n] missing key: ${path}`);
			}
			return import.meta.env?.PROD ? "" : path;
		}
		return String(resolved);
	};

	return { t, locale, dict, resource, I18nContext };
}

/** RTL locale list — mirrors AT5 spec. */
export const RTL_LOCALES: readonly Locale[] = [] as const;

/** Check if a locale is right-to-left. */
export function isRtl(_locale: Locale): boolean {
	return false;
}

export { detectLocale, dictionaries };
