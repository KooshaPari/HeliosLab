/**
 * T012 - Build infrastructure validation tests.
 *
 * Validates the monorepo build configuration: workspace resolution,
 * tsconfig strict mode, config inheritance, and lint suppression checks.
 *
 * Traces to: FR-RUN-001 (Bun workspaces), FR-RUN-002 (package.json setup),
 * FR-RUN-005 (typecheck command), FR-RUN-006 (build command)
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");

function _readJson(relativePath: string): unknown {
  const fullPath = resolve(ROOT, relativePath);
  return JSON.parse(Bun.file(fullPath).text() as unknown as string);
}

/**
 * Strip JSONC comments (block and line) without breaking strings.
 * Walks character-by-character to respect quoted regions.
 */
function stripJsonComments(input: string): string {
  let result = "";
  let i = 0;
  const len = input.length;
  while (i < len) {
    const ch = input[i];
    const next = input[i + 1];
    // String literal: copy verbatim until closing quote
    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (input[j] === "\\") {
          j += 2;
          continue;
        }
        if (input[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      result += input.slice(i, j);
      i = j;
      continue;
    }
    // Block comment
    if (ch === "/" && next === "*") {
      const end = input.indexOf("*/", i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    // Line comment
    if (ch === "/" && next === "/") {
      const end = input.indexOf("\n", i + 2);
      i = end === -1 ? len : end;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

async function readJsonAsync(relativePath: string): Promise<Record<string, unknown>> {
  const fullPath = resolve(ROOT, relativePath);
  const text = await Bun.file(fullPath).text();
  return JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
}

describe("workspace configuration", () => {
  test("root package.json declares both workspace paths", async () => {
    const pkg = await readJsonAsync("package.json");
    const workspaces = pkg["workspaces"] as string[];
    expect(workspaces).toContain("apps/desktop");
    expect(workspaces).toContain("apps/runtime");
  });

  test("bunfig.toml exists and contains install settings", async () => {
    const content = await Bun.file(resolve(ROOT, "bunfig.toml")).text();
    expect(content).toContain("[install]");
    expect(content).toContain("exact = true");
  });

  test("bun.lock exists (deterministic lockfile)", () => {
    expect(existsSync(resolve(ROOT, "bun.lock"))).toBe(true);
  });
});

describe("tsconfig strict mode", () => {
  test("tsconfig.base.json has strict mode enabled", async () => {
    const config = await readJsonAsync("tsconfig.base.json");
    const opts = config["compilerOptions"] as Record<string, unknown>;
    expect(opts["strict"]).toBe(true);
  });

  test("tsconfig.base.json has noUncheckedIndexedAccess", async () => {
    const config = await readJsonAsync("tsconfig.base.json");
    const opts = config["compilerOptions"] as Record<string, unknown>;
    expect(opts["noUncheckedIndexedAccess"]).toBe(true);
  });

  test("tsconfig.base.json has exactOptionalPropertyTypes", async () => {
    const config = await readJsonAsync("tsconfig.base.json");
    const opts = config["compilerOptions"] as Record<string, unknown>;
    expect(opts["exactOptionalPropertyTypes"]).toBe(true);
  });
});

describe("workspace tsconfig inheritance", () => {
  test("apps/runtime/tsconfig.json extends base", async () => {
    const config = await readJsonAsync("apps/runtime/tsconfig.json");
    expect(config["extends"]).toBe("../../tsconfig.base.json");
  });

  test("apps/desktop/tsconfig.json extends base", async () => {
    const config = await readJsonAsync("apps/desktop/tsconfig.json");
    expect(config["extends"]).toBe("../../tsconfig.base.json");
  });

  test("both workspace tsconfigs use composite mode", async () => {
    const runtime = await readJsonAsync("apps/runtime/tsconfig.json");
    const desktop = await readJsonAsync("apps/desktop/tsconfig.json");
    const rOpts = runtime["compilerOptions"] as Record<string, unknown>;
    const dOpts = desktop["compilerOptions"] as Record<string, unknown>;
    expect(rOpts["composite"]).toBe(true);
    expect(dOpts["composite"]).toBe(true);
  });
});

describe("path alias configuration", () => {
  test("tsconfig.base.json declares @helios/runtime path alias", async () => {
    const config = await readJsonAsync("tsconfig.base.json");
    const opts = config["compilerOptions"] as Record<string, unknown>;
    const paths = opts["paths"] as Record<string, string[]>;
    expect(paths["@helios/runtime"]).toBeDefined();
    expect(paths["@helios/runtime/*"]).toBeDefined();
  });

  test("tsconfig.base.json declares @helios/desktop path alias", async () => {
    const config = await readJsonAsync("tsconfig.base.json");
    const opts = config["compilerOptions"] as Record<string, unknown>;
    const paths = opts["paths"] as Record<string, string[]>;
    expect(paths["@helios/desktop"]).toBeDefined();
    expect(paths["@helios/desktop/*"]).toBeDefined();
  });
});

describe("workspace dependency graph", () => {
  test("no circular workspace dependencies", async () => {
    const runtime = await readJsonAsync("apps/runtime/package.json");
    const desktop = await readJsonAsync("apps/desktop/package.json");

    const runtimeDeps = {
      ...(runtime["dependencies"] as Record<string, string> | undefined),
      ...(runtime["devDependencies"] as Record<string, string> | undefined),
    };
    const desktopDeps = {
      ...(desktop["dependencies"] as Record<string, string> | undefined),
      ...(desktop["devDependencies"] as Record<string, string> | undefined),
    };

    // desktop depends on runtime, runtime must NOT depend on desktop
    expect(desktopDeps["@helios/runtime"]).toBeDefined();
    expect(runtimeDeps["@helios/desktop"]).toBeUndefined();
  });
});

describe("lint suppression directives", () => {
  test("no @ts-ignore or @ts-expect-error in source files", async () => {
    const glob = new Bun.Glob("**/*.ts");
    const suppressionPattern = /@ts-ignore|@ts-expect-error/;

    const srcDirs = [resolve(ROOT, "apps/runtime/src"), resolve(ROOT, "apps/desktop/src")];

    for (const dir of srcDirs) {
      if (!existsSync(dir)) continue;
      for await (const path of glob.scan({ cwd: dir, absolute: true })) {
        // Skip test files - they are allowed to have suppression directives
        if (path.includes("__tests__") || path.includes(".test.") || path.includes(".spec.")) {
          continue;
        }
        const content = await Bun.file(path).text();
        const relativePath = path.replace(ROOT + "/", "");
        expect(
          suppressionPattern.test(content),
          `Found suppression directive in ${relativePath}`
        ).toBe(false);
      }
    }
  });
});
