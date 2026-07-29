// packages/runtime-core/src/a11y/index.ts
// Barrel export for the a11y primitives. Apps and packages import via
// `@helios/runtime-core/a11y`.

export {
  createAnnouncer,
  getAnnouncer,
  type AnnounceLevel,
  type Announcer,
} from "./announce.js";
export {
  getFocusRingTokens,
  type FocusRingTokens,
} from "./tokens.js";
export {
  applyLocale,
  directionFor,
  readLocaleFromCookie,
  RTL_LOCALES,
  SUPPORTED_LOCALES,
  type Direction,
  type LocaleCode,
} from "./dir.js";
