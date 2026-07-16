import { describe, expect, test } from "bun:test";

import { ProtectedPathDetector } from "../protected-paths-detector.js";
import { extractFilePaths, matchesPattern } from "../protected-paths-matching.js";

describe("protected path matching on Windows", () => {
  test("glob patterns match backslash-separated protected directories", () => {
    expect(matchesPattern(String.raw`C:\repo\secrets\token`, "**/secrets/**")).toBe(true);
  });

  test("Windows file-reading commands preserve backslash-only paths", () => {
    expect(extractFilePaths(String.raw`type C:\repo\secrets\token`)).toEqual([
      String.raw`C:\repo\secrets\token`,
    ]);
    expect(extractFilePaths(String.raw`Get-Content C:\repo\secrets\token`)).toEqual([
      String.raw`C:\repo\secrets\token`,
    ]);
  });

  test("detector warns for a Windows protected path command", () => {
    const detector = new ProtectedPathDetector();

    const matches = detector.check(String.raw`Get-Content C:\repo\secrets\token`);

    expect(matches).toEqual([
      expect.objectContaining({
        patternId: "secrets-dir",
        matchedPath: String.raw`C:\repo\secrets\token`,
      }),
    ]);
  });
});
