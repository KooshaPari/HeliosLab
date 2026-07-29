// apps/desktop/src/a11y/DirProvider.tsx
// Solid context provider that applies the locale's direction to <html>
// and exposes a `locale` signal to children. Pairs with applyLocale()
// from @helios/runtime-core/a11y/dir.

import {
  type Component,
  type JSX,
  createContext,
  createSignal,
  onMount,
  useContext,
} from "solid-js";
import {
  type LocaleCode,
  applyLocale,
  readLocaleFromCookie,
} from "../../../../packages/runtime-core/src/a11y/dir.js";
import { setLocale as setI18nLocale } from "../../../../packages/runtime-core/src/i18n/index.js";

interface DirContextValue {
  locale: () => LocaleCode;
  setLocale: (l: LocaleCode) => void;
}

const DirContext = createContext<DirContextValue>();

export const DirProvider: Component<{ children: JSX.Element }> = props => {
  const [locale, setLocaleSignal] = createSignal<LocaleCode>(readLocaleFromCookie());

  onMount(() => {
    setI18nLocale(locale());
    applyLocale(locale());
  });

  const setLocale = (l: LocaleCode) => {
    setLocaleSignal(l);
    setI18nLocale(l);
    applyLocale(l);
  };

  return <DirContext.Provider value={{ locale, setLocale }}>{props.children}</DirContext.Provider>;
};

export function useDir(): DirContextValue {
  const ctx = useContext(DirContext);
  if (!ctx) throw new Error("useDir must be used inside <DirProvider>");
  return ctx;
}
