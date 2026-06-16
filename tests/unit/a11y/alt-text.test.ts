/**
 * tests/unit/a11y/alt-text.test.ts — assert every <img> in the HeliosLab
 * renderer has alt text. Decorative images use alt="" (empty string), which
 * is the WCAG-compliant way to mark something as decorative.
 *
 * Strategy: walk all .tsx/.html files under src/, parse with a tiny regex
 * (we don't have a TSX parser available in unit tests), and assert each
 * <img> tag has an alt attribute.
 */
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SRC_ROOT = join(import.meta.dir, "..", "..", "src");

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const s = statSync(full);
		if (s.isDirectory()) {
			out.push(...walk(full));
		} else if ([".tsx", ".html"].includes(extname(name))) {
			out.push(full);
		}
	}
	return out;
}

function findImgTags(src: string): Array<{ match: string; index: number }> {
	const results: Array<{ match: string; index: number }> = [];
	const re = /<img\b[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(src)) !== null) {
		results.push({ match: m[0], index: m.index });
	}
	return results;
}

describe("a11y: alt text on <img>", () => {
	const files = walk(SRC_ROOT);

	it("at least one renderable file exists (sanity check)", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		describe(file.replace(`${SRC_ROOT}/`, ""), () => {
			const src = readFileSync(file, "utf8");
			const imgs = findImgTags(src);

			if (imgs.length === 0) {
				it("contains no <img> tags (no requirement to assert)", () => {
					expect(imgs.length).toBe(0);
				});
				continue;
			}

			for (const { match } of imgs) {
				const hasAlt = /\balt\s*=/.test(match);
				it(`<img> has alt attribute: ${match.slice(0, 60)}…`, () => {
					expect(hasAlt).toBe(true);
				});
			}
		});
	}
});
