import { describe, it, expect } from "bun:test";
import { HeliosAppError, ErrorCode } from "../src/index";

// Traces to: FR-BUS-007 (error taxonomy)
describe("HeliosAppError", () => {
  it("should create an error with code and message", () => {
    const error = new HeliosAppError(ErrorCode.INTERNAL_ERROR, "test message");
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).toBe("test message");
  });

  it("should include details and fatal flag", () => {
    const error = new HeliosAppError(ErrorCode.INVALID_ARGUMENT, "bad arg", {
      details: { field: "name" },
      fatal: true,
    });
    expect(error.details?.field).toBe("name");
    expect(error.fatal).toBe(true);
  });

  it("should serialize to JSON correctly", () => {
    const error = new HeliosAppError(ErrorCode.NOT_FOUND, "not found", {
      details: { id: "123" },
    });
    const json = error.toJSON();
    expect(json.code).toBe("NOT_FOUND");
    expect(json.message).toBe("not found");
    expect(json.details?.id).toBe("123");
  });

  it("should default fatal to false", () => {
    const error = new HeliosAppError(ErrorCode.TIMEOUT, "timed out");
    expect(error.fatal).toBe(false);
  });
});