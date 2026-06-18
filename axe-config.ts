/**
 * axe-core shared configuration for the HeliosLab a11y test suite.
 *
 * Tag set covers WCAG 2.0 A/AA + WCAG 2.1 A/AA — the legal baseline for
 * Phenotype web/desktop surfaces. Excluded rules:
 *  - `bypass`: Monaco's complex DOM (sidebar / editor / tabs split) can't
 *      always provide a "skip" link the rule expects.
 *  - `region`: A desktop app window is not a web page — landmark regions
 *      don't apply in the same way.
 *  - `color-contrast`: Monaco's syntax-highlight tokens have non-text
 *      contrast; this is verified by a separate monaco-theme audit.
 */
export const AXE_TAGS = [
	"wcag2a",
	"wcag2aa",
	"wcag21a",
	"wcag21aa",
] as const;

export const AXE_DISABLED_RULES = [
	"bypass",
	"region",
	"color-contrast",
] as const;

export const AXE_OPTIONS = {
	rules: AXE_DISABLED_RULES.reduce<Record<string, { enabled: boolean }>>(
		(acc, id) => {
			acc[id] = { enabled: false };
			return acc;
		},
		{},
	),
	runOnly: {
		type: "tag",
		values: AXE_TAGS as unknown as string[],
	},
	resultTypes: ["violations"] as const,
} as const;

export type AxeImpact = "minor" | "moderate" | "serious" | "critical";

/** Filter helper — kept in one place so all spec files agree. */
export function blockingViolations(
	results: { violations: Array<{ impact?: string | null; id: string; nodes: unknown[] }> },
) {
	return results.violations.filter(
		(v) => v.impact === "critical" || v.impact === "serious",
	);
}
