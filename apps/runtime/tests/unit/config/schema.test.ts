import { describe, expect, it } from "bun:test";
import {
  SETTINGS_SCHEMA,
  getDefault,
  getAllDefaults,
  validateValue,
} from "../../../src/config/schema.js";

// Traces to: FR-CFG-001 (typed settings schema), FR-CFG-002 (validate settings)
describe("getDefault", () => {
  it("returns correct default for renderer_engine", () => {
    expect(getDefault("renderer_engine")).toBe("ghostty");
  });

  it("returns correct default for theme", () => {
    expect(getDefault("theme")).toBe("system");
  });

  it("returns correct default for terminal.scrollback_lines", () => {
    expect(getDefault("terminal.scrollback_lines")).toBe(10000);
  });

  it("returns correct default for telemetry.enabled", () => {
    expect(getDefault("telemetry.enabled")).toBe(false);
  });

  it("returns undefined for unknown key", () => {
    expect(getDefault("nonexistent.key")).toBeUndefined();
  });
});

describe("getAllDefaults", () => {
  it("returns an object with all schema keys", () => {
    const defaults = getAllDefaults();
    expect(Object.keys(defaults).sort()).toEqual(Object.keys(SETTINGS_SCHEMA).sort());
  });
});

// FR-002: Validation
describe("validateValue", () => {
  // Enum
  it("accepts valid enum value", () => {
    expect(validateValue("theme", "dark").valid).toBe(true);
  });

  it("rejects invalid enum value", () => {
    const r = validateValue("theme", "purple");
    expect(r.valid).toBe(false);
  });

  // Number range
  it("accepts number in range", () => {
    expect(validateValue("terminal.scrollback_lines", 5000).valid).toBe(true);
  });

  it("rejects number below range", () => {
    expect(validateValue("terminal.scrollback_lines", 500).valid).toBe(false);
  });

  it("rejects number above range", () => {
    expect(validateValue("terminal.scrollback_lines", 200000).valid).toBe(false);
  });

  // Boolean
  it("accepts boolean", () => {
    expect(validateValue("telemetry.enabled", true).valid).toBe(true);
  });

  it("rejects non-boolean", () => {
    expect(validateValue("telemetry.enabled", "yes").valid).toBe(false);
  });

  // Null / undefined
  it("rejects null for defined setting", () => {
    expect(validateValue("theme", null).valid).toBe(false);
  });

  it("rejects undefined for defined setting", () => {
    expect(validateValue("theme", undefined).valid).toBe(false);
  });

  // NaN / Infinity
  it("rejects NaN", () => {
    expect(validateValue("terminal.scrollback_lines", NaN).valid).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(validateValue("terminal.scrollback_lines", Infinity).valid).toBe(false);
  });

  // Unknown key — valid (forward-compat) // FR-005
  it("returns valid for unknown key", () => {
    expect(validateValue("future.setting", 42).valid).toBe(true);
  });
});
