// packages/runtime-core/src/i18n/index.ts
// Shared t() function for heliosApp. Both apps/desktop and apps/runtime use
// the same key path semantics.
//
// Usage:
//   import { t, setLocale } from "@helios/runtime-core/i18n";
//   setLocale("es");
//   <h1>{t("app.name")}</h1>
//   t("status.compileComplete", { duration: 1240 })
//
// Locale JSONs live in packages/runtime-core/src/i18n/{en,es,...}.json and
// are loaded eagerly at startup. Add a new locale by dropping a JSON file
// and registering it in SUPPORTED_LOCALES (a11y/dir.ts).

import en from "./en.json";
import es from "./es.json";
import { type LocaleCode, SUPPORTED_LOCALES } from "../a11y/dir.js";

export type Dict = Record<string, unknown>;

const TABLES: Record<LocaleCode, Dict> = {
  en: en as Dict,
  es: es as Dict,
  ar: en as Dict, // placeholders; populated when ar.json lands
  he: en as Dict,
  fa: en as Dict,
  ur: en as Dict,
};

let currentLocale: LocaleCode = "en";

export function setLocale(locale: LocaleCode): void {
  if (!SUPPORTED_LOCALES.has(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }
  currentLocale = locale;
}

export function getLocale(): LocaleCode {
  return currentLocale;
}

function lookup(dict: Dict, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Dict)) {
      cur = (cur as Dict)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === undefined ? `{${key}}` : String(v);
  });
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const table = TABLES[currentLocale] ?? TABLES.en;
  const raw = lookup(table, key);
  if (typeof raw !== "string") {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[i18n] missing key: ${key} (locale=${currentLocale})`);
    }
    return key;
  }
  return interpolate(raw, vars);
}

export const LOCALES = { en, es } as const;
