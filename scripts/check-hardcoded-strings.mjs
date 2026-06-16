#!/usr/bin/env bun
/**
 * scripts/check-hardcoded-strings.mjs — companion to check-i18n-keys.mjs.
 *
 * Scans src/** /*.{tsx,ts} for English text fragments inside attribute values
 * (placeholder, title, alt, aria-label) and asserts each one matches a key
 * in en.json. Catches the common mistake of writing
 *   <input placeholder="Search files" />
 * without going through the i18n layer.
 *
 * Run from repo root. Exits non-zero on violations.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const EN_DICT = JSON.parse(
	readFileSync(join(SRC, "i18n", "en.json"), "utf8"),
);

function flatten(obj, prefix = "") {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === "object") Object.assign(out, flatten(v, path));
		else out[path] = v;
	}
	return out;
}

// Build a set of *values* in en.json. If the hardcoded string matches one of
// these, we know it's intentionally the untranslated value and the key is
// already in the dictionary.
const KNOWN_VALUES = new Set(
	Object.values(flatten(EN_DICT)).map((v) => String(v).toLowerCase()),
);

function walk(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const s = statSync(full);
		if (s.isDirectory()) out.push(...walk(full));
		else if ([".tsx", ".ts"].includes(extname(name))) out.push(full);
	}
	return out;
}

const ATTRS = ["placeholder", "title", "alt", "aria-label"];
const violations = [];

for (const file of walk(SRC)) {
	const src = readFileSync(file, "utf8");
	const rel = relative(ROOT, file);

	for (const attr of ATTRS) {
		const re = new RegExp(`\\b${attr}\\s*=\\s*"([^"]+)"`, "g");
		let m;
		while ((m = re.exec(src)) !== null) {
			const val = m[1].trim();
			if (!val || val.length < 3) continue;
			if (KNOWN_VALUES.has(val.toLowerCase())) continue;
			violations.push({
				file: rel,
				attr,
				value: val,
			});
		}
	}
}

if (violations.length > 0) {
	console.error(
		`[check-hardcoded-strings] ${violations.length} untranslated attribute value(s):`,
	);
	for (const v of violations.slice(0, 20)) {
		console.error(`  ${v.file}  ${v.attr}="${v.value}"`);
	}
	if (violations.length > 20) {
		console.error(`  … and ${violations.length - 20} more`);
	}
	process.exit(1);
}

console.log(
	"[check-hardcoded-strings] OK — all placeholder/title/alt/aria-label values match en.json",
);
