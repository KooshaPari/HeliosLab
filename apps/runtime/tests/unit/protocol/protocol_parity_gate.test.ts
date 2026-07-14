/**
 * FR-HELIOS-061: Protocol Parity Gate Tests
 * Verifies: FR-CI-008 (Static analysis gate), FR-BUS-003 (Method registry)
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

const gate = "tools/gates/protocol-parity.mjs";

function runGate(fixtureRoot: string): { ok: boolean; output: string } {
  try {
    const stdout = execFileSync("node", [gate, "--fixture-root", fixtureRoot], {
      encoding: "utf8",
    });
    return { ok: true, output: stdout };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("protocol parity gate", () => {
  test("passes on complete formal mapping", () => {
    const result = runGate("apps/runtime/tests/fixtures/protocol-parity/pass");
    expect(result.ok).toBeTrue();
    expect(result.output).toContain("Protocol parity gate passed.");
  });

  test("fails closed when formal topic is unmapped", () => {
    const result = runGate("apps/runtime/tests/fixtures/protocol-parity/fail_missing_topic");
    expect(result.ok).toBeFalse();
    expect(result.output).toContain("Formal topic 'diagnostics.metric' missing from parity matrix");
  });
});
