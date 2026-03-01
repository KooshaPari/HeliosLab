export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export async function execCommand(command: string, args: string[]): Promise<ExecResult> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutBuf, stderrBuf, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);

  return {
    code,
    stdout: new TextDecoder().decode(stdoutBuf),
    stderr: new TextDecoder().decode(stderrBuf),
  };
}
