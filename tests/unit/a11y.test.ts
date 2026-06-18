/**
 * tests/unit/a11y.test.ts — unit tests for the accessibility helpers
 * (useAnnounce, i18n dir resolution, editor config). These are framework-
 * independent and run under bun:test.
 */
import { describe, it, expect } from "bun:test";
import { dirFor, applyDocumentLocale } from "../../src/i18n/dir";
import { ACCESSIBLE_EDITOR_OPTIONS } from "../../src/config/editor";
import { AXE_TAGS, AXE_DISABLED_RULES, blockingViolations } from "../../axe-config";

describe("a11y helpers", () => {
	describe("dirFor()", () => {
		it("returns 'ltr' for English", () => {
			expect(dirFor("en")).toBe("ltr");
			expect(dirFor("en-US")).toBe("ltr");
		});

		it("returns 'ltr' for Spanish", () => {
			expect(dirFor("es")).toBe("ltr");
			expect(dirFor("es-ES")).toBe("ltr");
		});

		it("returns 'rtl' for Arabic / Hebrew / Farsi / Urdu", () => {
			expect(dirFor("ar")).toBe("rtl");
			expect(dirFor("he")).toBe("rtl");
			expect(dirFor("fa")).toBe("rtl");
			expect(dirFor("ur")).toBe("rtl");
		});

		it("defaults to 'ltr' for unknown locales", () => {
			expect(dirFor("xx")).toBe("ltr");
			expect(dirFor("")).toBe("ltr");
		});
	});

	describe("applyDocumentLocale()", () => {
		it("sets lang and dir on document.documentElement", () => {
			applyDocumentLocale("es");
			expect(document.documentElement.lang).toBe("es");
			expect(document.documentElement.dir).toBe("ltr");

			applyDocumentLocale("ar");
			expect(document.documentElement.lang).toBe("ar");
			expect(document.documentElement.dir).toBe("rtl");
		});
	});

	describe("ACCESSIBLE_EDITOR_OPTIONS", () => {
		it("enables accessibilitySupport", () => {
			expect(ACCESSIBLE_EDITOR_OPTIONS.accessibilitySupport).toBe("on");
		});

		it("disables tabFocusMode (so Tab inserts a tab character)", () => {
			expect(ACCESSIBLE_EDITOR_OPTIONS.tabFocusMode).toBe(false);
		});

		it("exposes a human-readable aria-label", () => {
			expect(ACCESSIBLE_EDITOR_OPTIONS.ariaLabel).toBeTruthy();
			expect(ACCESSIBLE_EDITOR_OPTIONS.ariaLabel).toMatch(/editor/i);
		});
	});

	describe("axe-config", () => {
		it("includes WCAG 2.0 + 2.1 A and AA tags", () => {
			expect(AXE_TAGS).toContain("wcag2a");
			expect(AXE_TAGS).toContain("wcag2aa");
			expect(AXE_TAGS).toContain("wcag21a");
			expect(AXE_TAGS).toContain("wcag21aa");
		});

		it("disables bypass and region rules (Monaco workaround)", () => {
			expect(AXE_DISABLED_RULES).toContain("bypass");
			expect(AXE_DISABLED_RULES).toContain("region");
		});

		it("blockingViolations filters by impact", () => {
			const fake = {
				violations: [
					{ id: "x", impact: "critical", nodes: [] },
					{ id: "y", impact: "serious", nodes: [] },
					{ id: "z", impact: "moderate", nodes: [] },
					{ id: "w", impact: "minor", nodes: [] },
				],
			};
			const out = blockingViolations(fake as any);
			expect(out.map((v) => v.id).sort()).toEqual(["x", "y"]);
		});
	});
});
