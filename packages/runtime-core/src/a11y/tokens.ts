// packages/runtime-core/src/a11y/tokens.ts
// Cross-app token loader. Reads --focus-ring-* CSS custom properties from
// :root and exposes them as a typed object so per-app components can mirror
// the values in JS (e.g. for canvas drawing or focus-trap math). Falls back
// to the spec values if the DOM is not yet available (SSR, tests).

export interface FocusRingTokens {
  color: string;
  width: string;
  offset: string;
}

const FALLBACK: FocusRingTokens = {
  color: "#38bdf8",
  width: "2px",
  offset: "2px",
};

export function getFocusRingTokens(): FocusRingTokens {
  if (typeof document === "undefined") return FALLBACK;
  const styles = getComputedStyle(document.documentElement);
  return {
    color: styles.getPropertyValue("--focus-ring-color").trim() || FALLBACK.color,
    width:
      styles.getPropertyValue("--focus-ring-width").trim() || FALLBACK.width,
    offset:
      styles.getPropertyValue("--focus-ring-offset").trim() || FALLBACK.offset,
  };
}
