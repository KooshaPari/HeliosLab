import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@vue/compiler-sfc";
import MarkdownIt from "markdown-it";

/**
 * Regression guard for the docs build.
 *
 * vitepress renders markdown to HTML with markdown-it and then hands the
 * result to the Vue SFC parser, which reads any `<word>` as an opening tag.
 * A tag in bare prose survives markdown-it as raw HTML, and if nothing closes
 * it the build dies with "Element is missing end tag". The same token inside
 * backticks or a fenced block is escaped to `&lt;...&gt;` and is harmless.
 *
 * That distinction is what docs/reports/AUDIT_20260325.md got wrong, which
 * left Pages and Deploy docs red on every push to main from 2026-09-18.
 *
 * The guard runs the real pipeline rather than pattern-matching the markdown.
 * An earlier attempt reimplemented inline-code detection and produced false
 * positives on legitimate constructs: multi-line double-backtick spans, theme
 * components, autolinks, TypeScript generics, and components that close on a
 * later line. Reproducing markdown-it badly is worse than useless, because a
 * guard that cries wolf gets disabled. Over all of docs/ the real pipeline is
 * cheap enough to run for real: ~420ms of markdown-it rendering plus ~755ms of
 * Vue parsing cold, and ~235ms once both are warm, across 233 files and about
 * 1.1MB of markdown. That is the floor this guard pays, and the reason it does
 * not need to be made cleverer.
 *
 * Those figures are also why this file sets an explicit timeout. The scan is
 * the only test in the suite that touches all 233 documents, so under
 * full-suite load on a busy runner it has been measured at 10.7s against the
 * 5s default, while alone it takes ~1.1s. A default-budget test that only
 * fails when the machine is loaded trains people to ignore it, so the budget is
 * stated here instead. `stage-gates.yml` already runs the suite at 30s for the
 * same reason, but `ci.yml` runs it at the 5s default, and that job is the one
 * people actually read.
 */

const DOCS_ROOT = join(process.cwd(), "docs");

// The same options vitepress uses for markdown rendering.
const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

function walk(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		let st;
		try {
			st = statSync(p);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			if (["node_modules", ".vitepress", "dist"].includes(entry)) continue;
			walk(p, acc);
		} else if (entry.endsWith(".md")) {
			acc.push(p);
		}
	}
	return acc;
}

/**
 * Files the real pipeline would reject, with the position it complains about.
 *
 * The wrapper matters. vitepress builds each page as
 * `<template><div>${html}</div></template>` and hands that to the SFC
 * compiler, so the rendered HTML is template content. Parsing the bare HTML
 * on its own puts it at the top level of the SFC, where the compiler does not
 * read it as markup at all, and every broken document silently passes. That
 * mistake is what made an earlier version of this guard report zero failures
 * while its own positive controls failed.
 */
function unclosedIn(markdown: string, filename: string): string[] {
	const html = md.render(markdown);
	const sfc = `<template><div>${html}</div></template>`;
	const { errors } = parse(sfc, { filename });
	return errors
		.filter((e) => /missing end tag/i.test(e.message ?? ""))
		.map((e) =>
			e.loc
				? `${filename} @ ${e.loc.start.line}:${e.loc.start.column}`
				: `${filename} (no position)`,
		);
}

function scanDocs(): string[] {
	const hits: string[] = [];
	for (const f of walk(DOCS_ROOT)) {
		hits.push(...unclosedIn(readFileSync(f, "utf8"), f));
	}
	return hits;
}

describe("docs build has no unclosed tag in bare prose", () => {
	// 30s to match `stage-gates.yml`, which already budgets the whole suite at
	// that. Measured 10.7s under full-suite load, ~1.1s alone, so this is roughly
	// 3x the worst observed case rather than a number picked to make it green.
	const SCAN_TIMEOUT_MS = 30000;

	it("finds markdown files to scan", () => {
		expect(walk(DOCS_ROOT).length).toBeGreaterThan(100);
	});

	it(
		"reports no file that would break the vitepress build",
		() => {
			expect(scanDocs().join("\n")).toBe("");
		},
		SCAN_TIMEOUT_MS,
	);
});

describe("the guard actually catches the failure it exists for", () => {
	it("flags a redaction marker left in bare prose", () => {
		const broken = "**Working Directory:** /Users/<REDACTED>/CodeProjects/x";
		expect(unclosedIn(broken, "t.md")).toHaveLength(1);
	});

	it("accepts the same marker inside a code span", () => {
		const fixed = "**Working Directory:** `/Users/<REDACTED>/CodeProjects/x`";
		expect(unclosedIn(fixed, "t.md")).toEqual([]);
	});

	it("accepts the marker inside a fenced block", () => {
		const fenced = "```bash\ncd /Users/<REDACTED>/CodeProjects/x\n```";
		expect(unclosedIn(fenced, "t.md")).toEqual([]);
	});

	it("accepts HTML that is properly closed", () => {
		expect(
			unclosedIn(
				"see <br> and <details><summary>x</summary></details>",
				"t.md",
			),
		).toEqual([]);
	});

	it("accepts a component that closes on a later line", () => {
		expect(
			unclosedIn('<UserJourney title="x">\nbody\n</UserJourney>', "t.md"),
		).toEqual([]);
	});

	it("flags a component that is never closed", () => {
		expect(unclosedIn('<UserJourney title="x">', "t.md")).toHaveLength(1);
	});

	it("ignores a tag the parser never sees as HTML", () => {
		// A multi-line component start is not a raw HTML block to markdown-it, so
		// it is escaped rather than emitted. Whether that is desirable is a
		// separate question; the point here is that it cannot break the build.
		expect(unclosedIn('<UserJourney\n  title="x"\n>', "t.md")).toEqual([]);
	});

	it("accepts TypeScript generics and prose brackets", () => {
		expect(
			unclosedIn(
				"Record<string, unknown> and arrows <this-repo→other> here",
				"t.md",
			),
		).toEqual([]);
	});
});

describe("the file that broke the build", () => {
	const file = join(DOCS_ROOT, "reports", "AUDIT_20260325.md");
	const src = readFileSync(file, "utf8");

	it("keeps the redaction marker intact for the PII sweep audit trail", () => {
		expect(src).toContain("<REDACTED>");
	});

	it("renders without an unclosed tag", () => {
		expect(unclosedIn(src, file)).toEqual([]);
	});

	it("emits the marker escaped rather than as raw HTML", () => {
		const html = md.render(src);
		expect(html).toContain("&lt;REDACTED&gt;");
		expect(html).not.toMatch(/<REDACTED>/);
	});
});
