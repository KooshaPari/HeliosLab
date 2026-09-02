// tests/unit/a11y/alt-text.test.tsx
// Walks apps/desktop/src/components and apps/colab-renderer/src/components
// at build time and asserts that every <img> has an alt attribute. The lint
// rule jsx-a11y/alt-text (or a custom Solid equivalent) should already
// catch this in CI, but this test gives an extra safety net and is the
// pre-commit safety check the team runs locally.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const COMPONENT_DIRS = [
  join(ROOT, "apps/desktop/src/components"),
  join(ROOT, "apps/colab-renderer/src/components"),
];

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") || p.endsWith(".jsx")) out.push(p);
  }
  return out;
}

function findImgsWithoutAlt(src: string): string[] {
  // Naive JSX scan — looks for <img ...> opening tags missing an alt= attr.
  // Decorative images use alt="" which is valid; the rule only flags missing.
  const tagRe = /<img\b([^>]*?)>/g;
  const issues: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    const attrs = m[1] ?? "";
    if (!/\balt\s*=/.test(attrs)) {
      issues.push(`<img> without alt: ${m[0]}`);
    }
  }
  return issues;
}

describe("a11y: <img> alt-text policy", () => {
  for (const dir of COMPONENT_DIRS) {
    test(`${dir} has no <img> missing alt`, () => {
      const files = walk(dir);
      const all: string[] = [];
      for (const f of files) {
        const src = readFileSync(f, "utf-8");
        all.push(...findImgsWithoutAlt(src));
      }
      expect(all).toEqual([]);
    });
  }
});
