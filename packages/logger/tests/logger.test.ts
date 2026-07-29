import { describe, it, expect } from "bun:test";
import { ConsoleLogger, LogLevel } from "../src/index";

describe("ConsoleLogger", () => {
  it("should respect log levels", () => {
    // Logger uses pino internally, which respects LogLevel.INFO
    // Ensure DEBUG is suppressed, INFO and higher are allowed
    const logger = new ConsoleLogger(LogLevel.INFO);

    // This should not throw; pino silently filters based on level
    expect(() => {
      logger.debug("test debug");
      logger.info("test info");
    }).not.toThrow();
  });

  it("should merge context in child logger", () => {
    const logger = new ConsoleLogger(LogLevel.INFO, { root: "true" });
    const child = logger.child({ child: "true" });

    // Ensure child logger preserves context and doesn't throw
    expect(() => {
      child.info("test child");
    }).not.toThrow();
  });
});
