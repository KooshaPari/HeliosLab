import { PolicyClassification, PolicyPatternType, type PolicyRule } from "./types.js";

const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CLASSIFICATIONS = new Set<string>(Object.values(PolicyClassification));
const PATTERN_TYPES = new Set<string>(Object.values(PolicyPatternType));

export function validatePolicyWorkspaceId(workspaceId: string): void {
  if (!WORKSPACE_ID.test(workspaceId)) {
    throw new Error(`Invalid policy workspace ID: ${workspaceId}`);
  }
}

export function validatePolicyRules(
  workspaceId: string,
  value: unknown
): asserts value is PolicyRule[] {
  validatePolicyWorkspaceId(workspaceId);
  if (!Array.isArray(value)) throw new Error("Rules must be an array");

  const ids = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error("Policy rule must be an object");
    }

    const rule = candidate as Record<string, unknown>;
    if (typeof rule["id"] !== "string" || rule["id"].length === 0) {
      throw new Error("Rule must have an id field");
    }
    if (ids.has(rule["id"])) throw new Error(`Duplicate policy rule ID: ${rule["id"]}`);
    ids.add(rule["id"]);

    if (typeof rule["pattern"] !== "string" || rule["pattern"].length === 0) {
      throw new Error(`Rule ${rule["id"]} must have a pattern field`);
    }
    if (typeof rule["patternType"] !== "string" || !PATTERN_TYPES.has(rule["patternType"])) {
      throw new Error(`Rule ${rule["id"]} has invalid patternType`);
    }
    if (
      typeof rule["classification"] !== "string" ||
      !CLASSIFICATIONS.has(rule["classification"])
    ) {
      throw new Error(`Rule ${rule["id"]} has invalid classification`);
    }
    if (rule["scope"] !== workspaceId) {
      throw new Error(`Rule ${rule["id"]} scope must match workspace ${workspaceId}`);
    }
    if (typeof rule["priority"] !== "number" || !Number.isFinite(rule["priority"])) {
      throw new Error(`Rule ${rule["id"]} must have a finite numeric priority`);
    }
    if (typeof rule["description"] !== "string") {
      throw new Error(`Rule ${rule["id"]} must have a description`);
    }
    for (const key of ["createdAt", "updatedAt"] as const) {
      if (typeof rule[key] !== "string" || Number.isNaN(Date.parse(rule[key]))) {
        throw new Error(`Rule ${rule["id"]} has invalid ${key}`);
      }
    }
    if (
      rule["targets"] !== undefined &&
      (!Array.isArray(rule["targets"]) ||
        !rule["targets"].every(target => typeof target === "string"))
    ) {
      throw new Error(`Rule ${rule["id"]} has invalid targets`);
    }
    if (rule["patternType"] === PolicyPatternType.Regex) {
      try {
        new RegExp(rule["pattern"] as string);
      } catch {
        throw new Error(`Rule ${rule["id"]} has invalid regex pattern`);
      }
    }
  }
}
