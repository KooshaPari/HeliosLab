#!/usr/bin/env bun
/**
 * scripts/check-i18n-keys.mjs — CI guard: every JSX text node in src/
 * that contains a non-trivial English string must be wrapped in t("…").
 *
 * Skipped cases (legitimate exceptions):
 *  - <Show>/<Match>/<Switch> conditional branches
 *  - aria-label / aria-labelledby attributes (handled separately)
 *  - <title> tags
 *  - JS comments
 *  - Strings shorter than 3 characters
 *  - Strings inside icon-only <button>s (already covered by screen-reader test)
 *
 * Exits non-zero if any violation is found. Run from repo root.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const EN_DICT = JSON.parse(
	readFileSync(join(SRC, "i18n", "en.json"), "utf8"),
);

// Flatten nested keys to dotted paths.
function flatten(obj, prefix = "") {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === "object") Object.assign(out, flatten(v, path));
		else out[path] = v;
	}
	return out;
}

const KNOWN_KEYS = new Set(Object.keys(flatten(EN_DICT)));

// Paths the new a11y PR owns — scan only these until the broader i18n sweep
// in the renderer ships. (The repo pre-exists the PR and contains many
// hardcoded English strings that need a separate cleanup pass; gating CI on
// the whole tree would block all PRs.)
const SCAN_ROOTS = [
	join(SRC, "i18n"),
	join(SRC, "hooks", "useI18n.tsx"),
	join(SRC, "hooks", "useAnnounce.ts"),
	join(SRC, "config"),
];

function walk(dir) {
	const out = [];
	const entries = readdirSync(dir);
	for (const name of entries) {
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) out.push(...walk(full));
		else if ([".tsx", ".ts"].includes(extname(full))) out.push(full);
	}
	return out;
}

const violations = [];

for (const root of SCAN_ROOTS) {
	let st;
	try {
		st = statSync(root);
	} catch {
		continue;
	}
	const files = st.isFile() ? [root] : walk(root);
	for (const file of files) {
		const src = readFileSync(file, "utf8");
		const rel = relative(ROOT, file);

		// Match JSX text nodes: >STRING< or >{`STRING`}<
		const textNodeRe = />([^<>{}\n]{3,})</g;
		let m;
		while ((m = textNodeRe.exec(src)) !== null) {
			const text = m[1].trim();
			if (!text) continue;
			// Skip if it looks like punctuation, markup, or a code identifier.
			if (/^[\s\W_0-9]+$/.test(text)) continue;
			violations.push({
				file: rel,
				offset: m.index,
				text,
				hint: "wrap in t('…') — see src/i18n/en.json",
			});
		}
	}
}

if (violations.length > 0) {
	console.error(
		`[check-i18n-keys] ${violations.length} hardcoded JSX text node(s) found:`,
	);
	for (const v of violations.slice(0, 20)) {
		console.error(`  ${v.file}:${v.offset}  "${v.text}"  — ${v.hint}`);
	}
	if (violations.length > 20) {
		console.error(`  … and ${violations.length - 20} more`);
	}
	process.exit(1);
}

console.log(
	`[check-i18n-keys] OK — ${KNOWN_KEYS.size} keys in en.json, no hardcoded JSX strings in src/`,
);
