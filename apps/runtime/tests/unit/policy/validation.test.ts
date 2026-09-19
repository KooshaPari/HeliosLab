import { describe, expect, it } from "bun:test";
import {
	PolicyClassification,
	PolicyPatternType,
} from "../../../src/policy/types";
import {
	validatePolicyRules,
	validatePolicyWorkspaceId,
} from "../../../src/policy/validation";

function makeRule(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	const now = new Date().toISOString();
	return {
		id: "r1",
		pattern: "git *",
		patternType: PolicyPatternType.Glob,
		classification: PolicyClassification.Safe,
		scope: "ws1",
		priority: 10,
		description: "allow git",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

const OK = [makeRule()];

describe("validatePolicyWorkspaceId", () => {
	it("accepts well-formed ids", () => {
		expect(() => validatePolicyWorkspaceId("ws_1-A")).not.toThrow();
	});

	it("rejects empty, oversized, and shell-hostile ids", () => {
		expect(() => validatePolicyWorkspaceId("")).toThrow();
		expect(() => validatePolicyWorkspaceId("../escape")).toThrow();
		expect(() => validatePolicyWorkspaceId("a b")).toThrow();
		expect(() => validatePolicyWorkspaceId("x".repeat(129))).toThrow();
	});
});

describe("validatePolicyRules", () => {
	it("accepts a valid rule list", () => {
		expect(() => validatePolicyRules("ws1", OK)).not.toThrow();
	});

	it("rejects non-array input", () => {
		expect(() => validatePolicyRules("ws1", { id: "x" })).toThrow(/array/);
	});

	it("rejects non-object entries", () => {
		expect(() => validatePolicyRules("ws1", ["nope"])).toThrow(/object/);
	});

	it("rejects missing, empty, or duplicate ids", () => {
		expect(() => validatePolicyRules("ws1", [makeRule({ id: "" })])).toThrow(
			/id field/,
		);
		expect(() => validatePolicyRules("ws1", [makeRule({ id: 5 })])).toThrow(
			/id field/,
		);
		expect(() => validatePolicyRules("ws1", [makeRule(), makeRule()])).toThrow(
			/Duplicate/,
		);
	});

	it("rejects missing or empty pattern", () => {
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ pattern: "" })]),
		).toThrow(/pattern field/);
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ pattern: 7 })]),
		).toThrow(/pattern field/);
	});

	it("rejects unknown patternType or classification", () => {
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ patternType: "fuzzy" })]),
		).toThrow(/patternType/);
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ classification: "maybe" })]),
		).toThrow(/classification/);
	});

	it("rejects scope mismatch", () => {
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ scope: "ws2" })]),
		).toThrow(/scope/);
	});

	it("rejects non-numeric or non-finite priority", () => {
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ priority: "high" })]),
		).toThrow(/priority/);
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ priority: Number.NaN })]),
		).toThrow(/priority/);
	});

	it("rejects missing description", () => {
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ description: 42 })]),
		).toThrow(/description/);
	});

	it("rejects invalid createdAt/updatedAt", () => {
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ createdAt: "yesterday" })]),
		).toThrow(/invalid createdAt/);
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ updatedAt: null })]),
		).toThrow(/invalid updatedAt/);
	});

	it("rejects malformed targets", () => {
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ targets: "all" })]),
		).toThrow(/targets/);
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ targets: [1, 2] })]),
		).toThrow(/targets/);
	});

	it("accepts valid targets", () => {
		expect(() =>
			validatePolicyRules("ws1", [makeRule({ targets: ["src", "docs"] })]),
		).not.toThrow();
	});

	it("accepts a valid regex pattern and rejects an invalid one", () => {
		expect(() =>
			validatePolicyRules("ws1", [
				makeRule({ pattern: "^git (status|diff)$", patternType: "regex" }),
			]),
		).not.toThrow();
		expect(() =>
			validatePolicyRules("ws1", [
				makeRule({ pattern: "git (", patternType: "regex" }),
			]),
		).toThrow(/invalid regex/);
	});
});
