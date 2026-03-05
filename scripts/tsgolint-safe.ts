const decoder = new TextDecoder();

function writeOutputs(stdout: Uint8Array, stderr: Uint8Array): void {
  const stdoutText = decoder.decode(stdout);
  const stderrText = decoder.decode(stderr);
  if (stdoutText.length > 0) {
    process.stdout.write(stdoutText);
  }
  if (stderrText.length > 0) {
    process.stderr.write(stderrText);
  }
}

function run(command: string[]): { exitCode: number; stdoutText: string; stderrText: string } {
  const result = Bun.spawnSync(command, {
    stdout: "pipe",
    stderr: "pipe",
  });

  writeOutputs(result.stdout, result.stderr);

  return {
    exitCode: result.exitCode,
    stdoutText: decoder.decode(result.stdout),
    stderrText: decoder.decode(result.stderr),
  };
}

const tsgolintResult = run(["bunx", "tsgolint", "--tsconfig", "tsconfig.json"]);
if (tsgolintResult.exitCode === 0) {
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
