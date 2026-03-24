const decoder = new TextDecoder();
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

function reportedErrorCount(stdoutText: string, stderrText: string): number {
  const combinedOutput = stripAnsi(`${stdoutText}\n${stderrText}`);
  const match = /Found\s+(\d+)\s+errors\b/.exec(combinedOutput);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function writeOutputs(stdoutText: string, stderrText: string): void {
  if (stdoutText.length > 0) {
    process.stdout.write(stdoutText);
  }
  if (stderrText.length > 0) {
    process.stderr.write(stderrText);
  }
}

function run(command: readonly string[]): {
  exitCode: number;
  stdoutText: string;
  stderrText: string;
} {
  const result = Bun.spawnSync(command, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutText = decoder.decode(result.stdout);
  const stderrText = decoder.decode(result.stderr);
  writeOutputs(stdoutText, stderrText);

  return {
    exitCode: result.exitCode,
    stdoutText,
    stderrText,
  };
}

const tsgolintResult = run(["bunx", "tsgolint", "--tsconfig", "tsconfig.json"]);
if (tsgolintResult.exitCode === 0) {
  const errorCount = reportedErrorCount(tsgolintResult.stdoutText, tsgolintResult.stderrText);
  if (errorCount > 0) {
    console.error(`[lint] tsgolint reported ${errorCount} errors but exited 0.`);
    process.exit(1);
  }
  process.exit(0);
}

const combinedOutput = `${tsgolintResult.stdoutText}\n${tsgolintResult.stderrText}`;
if (!combinedOutput.includes("panic: runtime error")) {
  process.exit(tsgolintResult.exitCode);
}

console.error(
  "[lint] tsgolint panicked; falling back to 'tsgo --noEmit' for deterministic failure output.",
);
const fallbackResult = run(["bunx", "tsgo", "--noEmit"]);
process.exit(fallbackResult.exitCode);
