/**
 * FR-HELIOS-034: Protocol Schema Parity Tests
 * Verifies: FR-BUS-001 (Envelope schema), FR-BUS-006 (Envelope validation)
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCommand, createResponse, createEvent } from "../../../src/protocol/envelope.js";

// ---------------------------------------------------------------------------
// Minimal JSON Schema draft-07 validator (subset needed for envelope schema)
// ---------------------------------------------------------------------------

interface JsonSchema {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  oneOf?: JsonSchema[];
  minLength?: number;
  exclusiveMinimum?: number;
  additionalProperties?: boolean | JsonSchema;
  title?: string;
  description?: string;
  $schema?: string;
  $id?: string;
}

interface ValidationError {
  path: string;
  message: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Validator is a compact test helper for protocol parity.
function validateSchema(data: unknown, schema: JsonSchema, path = ""): ValidationError[] {
  const errors: ValidationError[] = [];

  if (schema.type !== undefined) {
    const actualType = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
    if (schema.type === "integer") {
      if (typeof data !== "number" || !Number.isInteger(data)) {
        errors.push({ path, message: `Expected integer, got ${actualType}` });
        return errors;
      }
    } else if (actualType !== schema.type) {
      errors.push({
        path,
        message: `Expected ${schema.type}, got ${actualType}`,
      });
      return errors;
    }
  }

  if (schema.const !== undefined && data !== schema.const) {
    errors.push({
      path,
      message: `Expected const ${String(schema.const)}, got ${String(data)}`,
    });
  }

  if (schema.enum !== undefined && !schema.enum.includes(data)) {
    errors.push({
      path,
      message: `Value ${String(data)} not in enum [${schema.enum.map(String).join(", ")}]`,
    });
  }

  if (
    schema.minLength !== undefined &&
    typeof data === "string" &&
    data.length < schema.minLength
  ) {
    errors.push({
      path,
      message: `String length ${String(data.length)} < minLength ${String(schema.minLength)}`,
    });
  }

  if (
    schema.exclusiveMinimum !== undefined &&
    typeof data === "number" &&
    data <= schema.exclusiveMinimum
  ) {
    errors.push({
      path,
      message: `Number ${String(data)} <= exclusiveMinimum ${String(schema.exclusiveMinimum)}`,
    });
  }

  if (schema.required !== undefined && typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const key of schema.required) {
      if (!(key in obj)) {
        errors.push({
          path: `${path}.${key}`,
          message: `Missing required field "${key}"`,
        });
      }
    }
  }

  if (schema.properties !== undefined && typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        errors.push(...validateSchema(obj[key], propSchema, `${path}.${key}`));
      }
    }
  }

  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter(sub => validateSchema(data, sub, path).length === 0);
    if (matches.length === 0) {
      errors.push({ path, message: "Does not match any oneOf schema" });
    } else if (matches.length > 1) {
      errors.push({
        path,
        message: `Matches ${String(matches.length)} oneOf schemas (expected exactly 1)`,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Load schema
// ---------------------------------------------------------------------------

const schemaPath = resolve(
  import.meta.dir,
  "../../../../../specs/protocol/v1/envelope.schema.json"
);
const schema: JsonSchema = JSON.parse(readFileSync(schemaPath, "utf-8")) as JsonSchema;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JSON Schema parity — runtime envelopes match canonical schema", () => {
  it("createCommand produces a schema-valid envelope", () => {
    const cmd = createCommand("test.method", { key: "value" });
    const errors = validateSchema(cmd, schema);
    expect(errors).toEqual([]);
  });

  it("createResponse produces a schema-valid envelope", () => {
    const cmd = createCommand("test.method", {});
    const res = createResponse(cmd, { result: 42 });
    const errors = validateSchema(res, schema);
    expect(errors).toEqual([]);
  });

  it("createResponse with error produces a schema-valid envelope", () => {
    const cmd = createCommand("test.method", {});
    const res = createResponse(cmd, null, {
      code: "HANDLER_ERROR",
      message: "Something went wrong",
    });
    const errors = validateSchema(res, schema);
    expect(errors).toEqual([]);
  });

  it("createEvent produces a schema-valid envelope", () => {
    const evt = createEvent("test.topic", { data: true });
    const errors = validateSchema(evt, schema);
    expect(errors).toEqual([]);
  });

  it("rejects envelope with missing id", () => {
    const bad = {
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use snake_case keys required by schema.
      correlation_id: "cor_123",
      timestamp: 1,
      type: "command",
      method: "test",
      payload: null,
    };
    const errors = validateSchema(bad, schema);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message.includes("id"))).toBe(true);
  });

  it("rejects envelope with empty id", () => {
    const bad = {
      id: "",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use snake_case keys required by schema.
      correlation_id: "cor_123",
      timestamp: 1,
      type: "command",
      method: "test",
      payload: null,
    };
    const errors = validateSchema(bad, schema);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects envelope with invalid type", () => {
    const bad = {
      id: "cmd_123",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use snake_case keys required by schema.
      correlation_id: "cor_123",
      timestamp: 1,
      type: "invalid",
      method: "test",
      payload: null,
    };
    const errors = validateSchema(bad, schema);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects event without sequence", () => {
    const bad = {
      id: "evt_123",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use snake_case keys required by schema.
      correlation_id: "cor_123",
      timestamp: 1,
      type: "event",
      topic: "test",
      payload: null,
    };
    const errors = validateSchema(bad, schema);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects event without topic", () => {
    const bad = {
      id: "evt_123",
      // biome-ignore lint/style/useNamingConvention: Protocol fixtures use snake_case keys required by schema.
      correlation_id: "cor_123",
      timestamp: 1,
      type: "event",
      payload: null,
      sequence: 1,
    };
    const errors = validateSchema(bad, schema);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("required fields in JSON schema match TypeScript type requirements", () => {
    // Base required fields
    expect(schema.required).toContain("id");
    expect(schema.required).toContain("correlation_id");
    expect(schema.required).toContain("timestamp");
    expect(schema.required).toContain("type");

    // oneOf branches
    const commandSchema = schema.oneOf?.find(s => s.title === "CommandEnvelope");
    const responseSchema = schema.oneOf?.find(s => s.title === "ResponseEnvelope");
    const eventSchema = schema.oneOf?.find(s => s.title === "EventEnvelope");

    expect(commandSchema).toBeDefined();
    expect(responseSchema).toBeDefined();
    expect(eventSchema).toBeDefined();

    const commandSchemaValue = commandSchema as JsonSchema;
    const responseSchemaValue = responseSchema as JsonSchema;
    const eventSchemaValue = eventSchema as JsonSchema;

    expect(commandSchemaValue.required).toContain("method");
    expect(commandSchemaValue.required).toContain("payload");
    expect(responseSchemaValue.required).toContain("method");
    expect(eventSchemaValue.required).toContain("topic");
    expect(eventSchemaValue.required).toContain("payload");
    expect(eventSchemaValue.required).toContain("sequence");
  });
});
