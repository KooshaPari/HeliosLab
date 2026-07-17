import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("security guard hook audit workflow", () => {
	test("runs the repository hooks locally without an external reusable workflow", () => {
		const workflow = readFileSync(
			join(
				import.meta.dir,
				"..",
				"..",
				".github",
				"workflows",
				"security-guard-hook-audit.yml",
			),
			"utf8",
		);

		expect(workflow).toContain("runs-on: ubuntu-latest");
		expect(workflow).toContain("git config core.hooksPath .github/hooks");
		expect(workflow).toContain("test -x .github/hooks/pre-commit");
		expect(workflow).toContain("test -x .github/hooks/security-guard.sh");
		expect(workflow).toContain(".github/hooks/pre-commit");
		expect(workflow).not.toContain("KooshaPari/phenoShared/");
	});
});
