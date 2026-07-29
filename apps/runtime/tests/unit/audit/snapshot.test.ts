/**
 * FR-AUD-006: Terminal session snapshot capture.
 */
import { describe, expect, it } from "bun:test";
import { SnapshotCapture } from "../../../src/audit/snapshot";

describe("SnapshotCapture", () => {
  it("should log callback errors without throwing", () => {
    const capture = new SnapshotCapture();
    const callbackError = new Error("callback failed");
    const originalConsoleError = console.error;
    const loggedErrors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      loggedErrors.push(args);
    };

    try {
      expect(() => {
        capture.captureNow("session-1", () => {
          throw callbackError;
        });
      }).not.toThrow();
    } finally {
      console.error = originalConsoleError;
    }

    expect(loggedErrors).toEqual([
      ["[SnapshotCapture] Failed to capture snapshot:", callbackError],
    ]);
  });
});
