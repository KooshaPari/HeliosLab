import {
  spawnSync,
  type SpawnSyncOptionsWithBufferEncoding,
} from "child_process";
import { BUN_PATH } from "../consts/paths";

// An execSync-like wrapper around spawnSync in the ~/.colab/.bun/ folder as cwd
export const execSpawnSync = (
  command: string,
  args: string[] = [],
  opts: SpawnSyncOptionsWithBufferEncoding = {}
): { stdout: string; stderr: string; exitCode: number | null } => {
  const result = spawnSync(command, args, {
    cwd: BUN_PATH,
    ...opts,
    env: {
      ...process.env,
      ...opts.env,
      CI: 'true', // Skip interactive prompts in CLIs
    },
  });

  if (result.error) {
    console.error(`error running ${command}`, result.error);
  }

  const stdout = result.stdout?.toString().trim() || "";
  const stderr = result.stderr?.toString().trim() || "";

  if (stderr) {
    console.error("stderr: ", stderr);
  }

  return {
    stdout,
    stderr,
    exitCode: result.status,
  };
};
