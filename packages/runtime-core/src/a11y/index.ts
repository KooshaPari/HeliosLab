// packages/runtime-core/src/a11y/index.ts
// Barrel export for the a11y primitives. Apps and packages import via
// `@helios/runtime-core/a11y`.

export {
	type AnnounceLevel,
	type Announcer,
	createAnnouncer,
	getAnnouncer,
} from "./announce.js";
export {
	applyLocale,
	type Direction,
	directionFor,
	type LocaleCode,
	RTL_LOCALES,
	readLocaleFromCookie,
	SUPPORTED_LOCALES,
} from "./dir.js";
export {
	type FocusRingTokens,
	getFocusRingTokens,
} from "./tokens.js";
