#!/usr/bin/env node
// scripts/check-hardcoded-strings.mjs
// CI gate: fails if any JSX text node in apps/ contains a hardcoded English
// string that is not wrapped in a t() call. Walks every .tsx file under
// apps/ and parses out the literal text content of JSX elements.
//
// Detection strategy:
//   1. Tokenize with a small regex-based JSX scanner (no Babel dep).
//   2. For each text run between > and < markers, check whether the run:
//      a) is a single space / punctuation / number (allowed)
//      b) matches a t("…") call pattern (allowed)
//      c) is wrapped in {t("…")} expression (allowed)
//      d) contains an English-like word (allowed chars: a-zA-Z')
//   3. Report any (d) as a violation.
//
// Exits with code 1 if any violations are found.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2] ?? "apps";
const SKIP_DIRS = new Set(["node_modules", "dist", ".vite"]);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") || p.endsWith(".jsx")) out.push(p);
  }
  return out;
}

function findHardcodedStrings(src) {
  const issues = [];
  // Match: `>some text<` (JSX text content). Skip expressions `>{...}<`.
  const textRe = />([^<>{]+)</g;
  let m;
  while ((m = textRe.exec(src))) {
    const raw = m[1];
    // Strip leading/trailing whitespace; ignore pure whitespace runs.
    const text = raw.replace(/^\s+|\s+$/g, "");
    if (text.length === 0) continue;
    // Skip if it looks like t() inside the expression — already covered by
    // the no-braces rule, but allow pure punctuation/numbers.
    if (/^[\d\s.,!?:;()'"-]+$/.test(text)) continue;
    // Heuristic: must contain at least 3 letters in a row to be a string.
    if (!/[A-Za-z]{3,}/.test(text)) continue;
    // Skip {var} interpolations like `Hello, {name}!` — already covered
    // because the expression portion is excluded by the regex.
    issues.push({ text, line: lineOf(src, m.index) });
  }
  return issues;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split("\n").length;
}

const files = walk(ROOT);
let totalIssues = 0;
for (const f of files) {
  const src = readFileSync(f, "utf-8");
  const issues = findHardcodedStrings(src);
  if (issues.length > 0) {
    console.error(`\n${relative(process.cwd(), f)}`);
    for (const i of issues) {
      console.error(`  L${i.line}: ${JSON.stringify(i.text)}`);
      totalIssues++;
    }
  }
}

if (totalIssues > 0) {
  console.error(
    `\n[check-hardcoded-strings] ${totalIssues} hardcoded string(s) found. Wrap with t() from @helios/runtime-core/i18n.`,
  );
  process.exit(1);
}
console.log("[check-hardcoded-strings] OK — no hardcoded strings detected.");
