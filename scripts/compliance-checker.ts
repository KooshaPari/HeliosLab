/**
 * Constitution Compliance Checker
 * Validates PRs against the constitution review checklist.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

interface Finding {
  check: string;
  filePath: string;
  line?: number;
  description: string;
  constitutionSection: string;
  constitutionLine?: number;
  remediationHint: string;
}

interface ChangedFile {
  filePath: string;
  status: string;
}

function parseChangedFile(input: string): ChangedFile {
  const markerIndex = input.lastIndexOf("::");
  if (markerIndex === -1) {
    return { filePath: input, status: "added" };
  }

  const filePath = input.slice(0, markerIndex);
  const status = input.slice(markerIndex + 2) || "added";
  return { filePath, status };
}

function normalizeChangedFiles(files: string[]): ChangedFile[] {
  return files.map(parseChangedFile);
}

/**
 * Per-file line limits (in lines). Files not listed use the default (500).
 * This allows principled exceptions for files that have legitimate reasons
 * to exceed the standard limit.
 */
const FILE_LINE_LIMITS: Record<string, number> = {
  "src/bus.ts": 900,
  "src/lanes/index.ts": 600,
  "src/providers/acp-client.ts": 600,
  "src/providers/mcp-bridge.ts": 600,
  "src/renderer/ghostty/backend.ts": 600,
  "src/secrets/protected-paths.ts": 600,
};

const DEFAULT_LINE_LIMIT = 500;
const DEFAULT_TEST_LINE_LIMIT = 800;

/**
 * File extensions that are exempt from the line-limit check.
 * Non-code files (docs, configs, lockfiles, test fixtures, etc.) should
 * not be subject to code-size limits.
 */
const LINE_LIMIT_EXEMPT_EXTENSIONS = new Set([
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".lock",
  ".lockb",
  ".css",
  ".html",
  ".svg",
  ".xml",
  ".txt",
  ".csv",
  ".env",
  ".gitignore",
  ".dockerignore",
]);

/**
 * Path fragments that exempt a file from line-limit checks.
 */
const LINE_LIMIT_EXEMPT_PATTERNS = [
  "bun.lock",
  "package-lock.json",
  "node_modules/",
  "__fixtures__/",
  ".archive/",
];

const CONSTITUTION_PATH = path.join(
  path.dirname(path.dirname(import.meta.url)).replace("file://", ""),
  "docs/reference/constitution.md"
);

/**
 * Load and parse the constitution.
 */
async function loadConstitution(): Promise<string> {
  try {
    return await fs.readFile(CONSTITUTION_PATH, "utf-8");
  } catch (_error) {
    return "";
  }
}

/**
 * Extract section headings from constitution markdown.
 */
function extractSections(constitution: string): Map<string, number> {
  const sections = new Map<string, number>();
  const lines = constitution.split("\n");

  lines.forEach((line, index) => {
    if (line.startsWith("## ")) {
      const sectionName = line.substring(3).trim();
      sections.set(sectionName, index + 1);
    }
  });

  return sections;
}

/**
 * Get the configured line limit for a file, using per-file overrides or the default.
 */
function getLineLimit(filePath: string): number {
  // Check for exact match or normalized path match
  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const [configPath, limit] of Object.entries(FILE_LINE_LIMITS)) {
    const normalizedConfig = configPath.replace(/\\/g, "/");
    if (normalizedPath.endsWith(normalizedConfig) || normalizedPath === normalizedConfig) {
      return limit;
    }
  }

  // Test files get a higher default limit
  if (normalizedPath.includes(".test.") || normalizedPath.includes(".spec.")) {
    return DEFAULT_TEST_LINE_LIMIT;
  }
  return DEFAULT_LINE_LIMIT;
}

/**
 * Whether a file should be exempt from line-limit checks.
 */
function isLineLimitExempt(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (LINE_LIMIT_EXEMPT_EXTENSIONS.has(ext)) {
    return true;
  }

  const normalized = filePath.replace(/\\/g, "/");
  return LINE_LIMIT_EXEMPT_PATTERNS.some(p => normalized.includes(p));
}

/**
 * Check for files exceeding configured line limits.
 */
async function checkFileSizes(files: string[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const sections = await loadConstitution().then(extractSections);
  const section = "Code Structure and Maintainability";
  const sectionLine = sections.get(section) || 0;
  const _lockfileNames = new Set(["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

  for (const filePath of files) {
    if (isLineLimitExempt(filePath)) {
      continue;
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n").length;
      const limit = getLineLimit(filePath);

      if (lines > limit) {
        findings.push({
          check: "File Size Limit",
          filePath,
          line: 1,
          description: `File exceeds ${limit}-line limit (${lines} lines)`,
          constitutionSection: section,
          constitutionLine: sectionLine,
          remediationHint:
            "Split file into smaller modules following single-responsibility principle",
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return findings;
}

/**
 * Check if a test file imports the source file (reverse lookup).
 * Handles common import patterns from the test perspective.
 */
async function testImportsSourceFile(
  testFilePath: string,
  sourceFilePath: string
): Promise<boolean> {
  try {
    const testContent = await fs.readFile(testFilePath, "utf-8");
    const normalizedSourcePath = sourceFilePath.replace(/\\/g, "/").replace(/\.(tsx?|mjs)$/, "");
    const sourceFileName = path.basename(sourceFilePath, path.extname(sourceFilePath));

    // Check for various import patterns
    const importPatterns = [
      new RegExp(`from\\s+['"]\\.?/?.*${sourceFileName}['"]`, "i"),
      new RegExp(`from\\s+['"]${normalizedSourcePath}['"]`, "i"),
      new RegExp(`require\\(['"]\\.?/?.*${sourceFileName}['"]`, "i"),
      new RegExp(`import\\(\\s*['"]\\.?/?.*${sourceFileName}['"]`, "i"),
    ];

    return importPatterns.some(pattern => pattern.test(testContent));
  } catch {
    return false;
  }
}

/**
 * Get candidate test paths for a source file.
 */
function getCandidateTestPaths(sourceFilePath: string): string[] {
  const normalized = sourceFilePath.replace(/\\/g, "/");
  const sourceWithoutExt = normalized.replace(/\.(tsx?|mjs)$/, "");
  const candidates = new Set<string>([
    `${sourceWithoutExt}.test.ts`,
    `${sourceWithoutExt}.spec.ts`,
  ]);

  if (normalized.includes("/src/")) {
    const mirroredUnit = normalized.replace("/src/", "/tests/unit/").replace(/\.(tsx?|mjs)$/, "");
    const mirroredIntegration = normalized
      .replace("/src/", "/tests/integration/")
      .replace(/\.(tsx?|mjs)$/, "");
    const mirroredBench = normalized.replace("/src/", "/tests/bench/").replace(/\.(tsx?|mjs)$/, "");

    candidates.add(`${mirroredUnit}.test.ts`);
    candidates.add(`${mirroredUnit}.spec.ts`);
    candidates.add(`${mirroredIntegration}.test.ts`);
    candidates.add(`${mirroredIntegration}.spec.ts`);
    candidates.add(`${mirroredBench}.test.ts`);
    candidates.add(`${mirroredBench}.spec.ts`);
  }

  return [...candidates];
}

/**
 * Find test files that import the given source file.
 */
async function findTestsImportingSource(
  sourceFilePath: string,
  files: string[]
): Promise<boolean> {
  for (const testPath of files) {
    if (
      !testPath.endsWith(".ts") &&
      !testPath.endsWith(".tsx") &&
      !testPath.endsWith(".js") &&
      !testPath.endsWith(".jsx")
    ) {
      continue;
    }

    if (!testPath.includes(".test.") && !testPath.includes(".spec.")) {
      continue;
    }

    if (await testImportsSourceFile(testPath, sourceFilePath)) {
      return true;
    }
  }

  return false;
}

/**
 * Check for test coverage via forward lookup (test file colocated/mirrored)
 * and reverse lookup (test file imports source file).
 */
async function checkTestCoverage(files: string[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const sections = await loadConstitution().then(extractSections);
  const section = "Test Coverage";
  const sectionLine = sections.get(section) || 0;

  for (const filePath of files) {
    // Skip documentation/build configuration files that are not expected to have paired tests.
    if (filePath.includes("/.vitepress/")) {
      continue;
    }

    // Only check source files, not test files
    if (filePath.includes(".test.") || filePath.includes(".spec.")) {
      continue;
    }

    // Skip fixture files (they are test artifacts, not source code)
    if (filePath.includes("/fixtures/") || filePath.includes("\\fixtures\\")) {
      continue;
    }

    if (!filePath.includes("node_modules") && filePath.endsWith(".ts")) {
      const candidateTestPaths = getCandidateTestPaths(filePath);
      let hasTestFile = false;

      for (const testPath of candidateTestPaths) {
        try {
          await fs.access(testPath);
          hasTestFile = true;
          break;
        } catch {
          // Continue searching other test locations.
        }
      }

      if (!hasTestFile && !(await findTestsImportingSource(filePath, files))) {
        findings.push({
          check: "Test Coverage",
          filePath,
          line: 1,
          description: "No corresponding test file found",
          constitutionSection: section,
          constitutionLine: sectionLine,
          remediationHint: `Create ${path.basename(filePath).replace(/\.(tsx?|mjs)$/, ".test.ts")} or a mirrored test under tests/unit/`,
        });
      }
    }
  }

  return findings;
}

/**
 * Check for unsafe patterns (any type, hardcoded secrets).
 * Only checks TypeScript source files, skipping test files and fixtures.
 */
async function checkUnsafePatterns(files: string[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const sections = await loadConstitution().then(extractSections);

  for (const filePath of files) {
    // Only check .ts/.tsx source files, skip tests and fixtures
    if (!(filePath.endsWith(".ts") || filePath.endsWith(".tsx"))) {
      continue;
    }
    if (filePath.includes(".test.") || filePath.includes(".spec.")) {
      continue;
    }
    if (filePath.includes("__fixtures__") || filePath.includes("__tests__")) {
      continue;
    }
    if (filePath.includes("node_modules")) {
      continue;
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line: string, index: number) => {
        // Check for 'any' type — match type annotations but not variable/property names containing "any"
        // Skip lines with inline suppression comments (eslint-disable, @ts-expect-error, etc.)
        if (
          /(?::\s*any\b|<any>|as\s+any\b)/.test(line) &&
          !/\/\//.test(line.split(/:\s*any\b/)[0])
        ) {
          const section = "Type Safety";
          findings.push({
            check: "Type Safety",
            filePath,
            line: index + 1,
            description: 'Use of "any" type detected',
            constitutionSection: section,
            constitutionLine: sections.get(section) || 0,
            remediationHint: "Replace with specific type or use `unknown` with type guard",
          });
        }

        // Check for hardcoded secrets
        if (/(?:API_KEY|SECRET|PASSWORD|TOKEN)\s*=\s*["']/.test(line)) {
          const section = "Security";
          findings.push({
            check: "Security",
            filePath,
            line: index + 1,
            description: "Potential hardcoded secret detected",
            constitutionSection: section,
            constitutionLine: sections.get(section) || 0,
            remediationHint: "Move to environment variables or secure config, never commit secrets",
          });
        }
      });
    } catch {
      // Skip files that can't be read
    }
  }

  return findings;
}

/**
 * Run all compliance checks.
 */
async function runComplianceChecks(files: string[]): Promise<CheckResult> {
  const allFindings: Finding[] = [];

  // Run all checks
  allFindings.push(...(await checkFileSizes(files)));
  allFindings.push(...(await checkTestCoverage(files)));
  allFindings.push(...(await checkUnsafePatterns(files)));

  // Type Safety findings are advisory (tracked but do not block compliance)
  const blockingFindings = allFindings.filter(f => f.check !== "Type Safety");
  return {
    passed: blockingFindings.length === 0,
    findings: allFindings,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format results as JSON.
 */
function formatJson(result: CheckResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format results as table.
 */
function formatTable(result: CheckResult): string {
  if (result.findings.length === 0) {
    return "All compliance checks passed!";
  }

  let output = "COMPLIANCE VIOLATIONS:\n\n";

  result.findings.forEach((finding, i) => {
    output += `${i + 1}. ${finding.check} (${finding.filePath}:${finding.line || "N/A"})\n`;
    output += `   Description: ${finding.description}\n`;
    output += `   Constitution: ${finding.constitutionSection}`;
    if (finding.constitutionLine) {
      output += ` (line ${finding.constitutionLine})`;
    }
    output += "\n";
    output += `   Remediation: ${finding.remediationHint}\n\n`;
  });

  return output;
}

/**
 * CLI entry point.
 */
if (import.meta.main) {
  const argv = typeof Bun !== "undefined" ? Bun.argv : (globalThis.process?.argv ?? []);
  const args = argv.slice(2);
  const format = args.includes("--json") ? "json" : "table";
  const files = args.filter((arg: string) => !arg.startsWith("--"));

  if (files.length === 0) {
    process.exitCode = 1;
  } else {
    runComplianceChecks(files)
      .then(result => {
        if (format === "json") {
          console.log(formatJson(result));
        } else {
          console.log(formatTable(result));
        }
        process.exitCode = result.passed ? 0 : 1;
      })
      .catch(_err => {
        process.exitCode = 1;
      });
  }
}

export { type CheckResult, type Finding, runComplianceChecks };
