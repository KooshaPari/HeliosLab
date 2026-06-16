/**
 * Solid hook binding the active locale to the I18nContext provider.
 *
 * Reads the user's preferred locale from localStorage (see `detectLocale` in
 * `../i18n/index.ts`) and exposes a `setLocale` setter that updates the
 * document's lang/dir attributes and re-renders all `t()` calls under the
 * provider. Combine with `useAnnounce` for status messages in translated form.
 */
import { createContext, createSignal, useContext, type JSX } from "solid-js";
import { createI18n, detectLocale, setLocale as persistLocale, type Locale } from "../i18n";
import { applyDocumentLocale } from "../i18n/dir";

export interface I18nContextValue {
	locale: () => Locale;
	setLocale: (next: Locale) => void;
	t: (path: string, ...args: unknown[]) => string;
}

const I18nContextDef = createContext<I18nContextValue>();

/** Provider component — wrap the root <App /> with this. */
export function I18nProvider(props: { children: JSX.Element }): JSX.Element {
	const [locale, setLocaleSignal] = createSignal<Locale>(detectLocale());
	const { t } = createI18n(locale);

	// Apply lang/dir on the <html> element whenever the locale changes.
	const setLocale = (next: Locale) => {
		setLocaleSignal(next);
		persistLocale(next);
		applyDocumentLocale(next);
	};

	// Initial application.
	if (typeof document !== "undefined") {
		applyDocumentLocale(locale());
	}

	return (
		<I18nContextDef.Provider value={{ locale, setLocale, t }}>
			{props.children}
		</I18nContextDef.Provider>
	);
}

/** Consumer hook — returns { locale, setLocale, t }. */
export function useI18n(): I18nContextValue {
	const ctx = useContext(I18nContextDef);
	if (!ctx) {
		throw new Error("useI18n must be used inside <I18nProvider>");
	}
	return ctx;
}
