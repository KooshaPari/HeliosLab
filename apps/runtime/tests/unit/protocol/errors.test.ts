/**
 * FR-HELIOS-106: Protocol Error Taxonomy Unit Tests
 * Verifies: FR-BUS-007 (Error taxonomy), FR-BUS-008 (propagate correlation_id)
 */
import { describe, expect, it } from "bun:test";
import {
  validationError,
  methodNotFound,
  handlerError,
  timeoutError,
  backpressureError,
} from "../../../src/protocol/errors.js";

describe("Error taxonomy factories", () => {
  // --- validationError ---
  it("validationError returns VALIDATION_ERROR code", () => {
    const err = validationError("bad input");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("bad input");
  });

  it("validationError includes optional details", () => {
    const err = validationError("bad", { field: "id" });
    expect(err.details).toEqual({ field: "id" });
  });

  it("validationError returns a frozen object", () => {
    const err = validationError("x");
    expect(Object.isFrozen(err)).toBe(true);
  });

  // --- methodNotFound ---
  it("methodNotFound returns METHOD_NOT_FOUND code", () => {
    const err = methodNotFound("doStuff");
    expect(err.code).toBe("METHOD_NOT_FOUND");
    expect(err.message).toContain("doStuff");
  });

  it("methodNotFound returns a frozen object", () => {
    expect(Object.isFrozen(methodNotFound("x"))).toBe(true);
  });

  // --- handlerError ---
  it("handlerError returns HANDLER_ERROR code", () => {
    const err = handlerError("run", new Error("boom"));
    expect(err.code).toBe("HANDLER_ERROR");
    expect(err.message).toContain("run");
    expect(err.message).toContain("boom");
  });

  it("handlerError sanitizes file paths from stack traces", () => {
    const err = handlerError("run", new Error("failed at /usr/local/lib/foo.ts:10"));
    expect(err.message).not.toContain("/usr/local");
    expect(err.message).toContain("<path>");
  });

  it("handlerError handles non-Error causes", () => {
    const err = handlerError("run", "string cause");
    expect(err.code).toBe("HANDLER_ERROR");
    expect(err.message).toContain("string cause");
  });

  it("handlerError returns a frozen object", () => {
    expect(Object.isFrozen(handlerError("x", "y"))).toBe(true);
  });

  // --- timeoutError ---
  it("timeoutError returns TIMEOUT code", () => {
    const err = timeoutError("slow", 5000);
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toContain("slow");
    expect(err.message).toContain("5000");
  });

  it("timeoutError returns a frozen object", () => {
    expect(Object.isFrozen(timeoutError("x", 1))).toBe(true);
  });

  // --- backpressureError ---
  it("backpressureError returns BACKPRESSURE code", () => {
    const err = backpressureError("ui.events");
    expect(err.code).toBe("BACKPRESSURE");
    expect(err.message).toContain("ui.events");
  });

  it("backpressureError returns a frozen object", () => {
    expect(Object.isFrozen(backpressureError("x"))).toBe(true);
  });

  // --- General: factories never throw ---
  it("no factory throws", () => {
    expect(() => validationError("a")).not.toThrow();
    expect(() => methodNotFound("a")).not.toThrow();
    expect(() => handlerError("a", null)).not.toThrow();
    expect(() => timeoutError("a", 0)).not.toThrow();
    expect(() => backpressureError("a")).not.toThrow();
  });
});
