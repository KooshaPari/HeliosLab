import { join, dirname } from "path";
import {
  rmdirSync,
  statSync,
  unlinkSync,
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "fs";
import {
  type CachedFileType,
  type PreviewFileTreeType,
} from "../../shared/types/types";
import { isPathSafe } from "../../shared/utils/files";
import { Utils } from "electrobun/bun";
import { BUN_BINARY_PATH, COLAB_ENV_PATH, FD_BINARY_PATH, RG_BINARY_PATH } from "../consts/paths";
import { spawn } from "child_process";
import path from "path";
import type { Subprocess } from "bun";

// helps prevent rmDirSync/unlink from being called on the system root or other important directories
export const safeTrashFileOrFolder = (absolutePath: string) => {
  if (isPathSafe(absolutePath)) {
    // Note: this puts things in the recycle bin, but without
    // the "put back" functionality
    // todo (yoav): maybe we can implement undo delete in colab

    Utils.moveToTrash(absolutePath);
  }
};

// helps prevent rmDirSync/unlink from being called on the system root or other important directories
export const safeDeleteFileOrFolder = (absolutePath: string) => {
  if (isPathSafe(absolutePath)) {
    const info = statSync(absolutePath);
    if (info.isDirectory()) {
      rmdirSync(absolutePath, { recursive: true });
    } else if (info.isFile()) {
      unlinkSync(absolutePath);
    }
  }
};

export const getUniqueNewName = (parentPath: string, baseName: string) => {
  let modifier = 1;
  let uniqueName = baseName;
  while (existsSync(join(parentPath, uniqueName))) {
    uniqueName = `${modifier.toString(36)}-${baseName}`;
    modifier++;
  }

  return uniqueName;
};

// Note: this can be used to read and cache any slate config file .colab.json, package.json, etc.
// currently only supports json files
export const readSlateConfigFile = (path: string, cacheResult = true) => {
  try {
    if (existsSync(path)) {
      if (!statSync(path)?.isFile()) {
        throw new Error(
          `Must give a file path (eg: to .colab.json), path given: ${path}`
        );
      }

      const slateJson = readFileSync(path, "utf-8");
      const slate = JSON.parse(slateJson);
      // NOTE: We want to update the cache whether it successfully reads or not
      // that way the user can see immediately if there's a problem with the config
      if (cacheResult) {
        // XXX send to windows
        // setState("slateCache", path, slate);
      }
      // todo (yoav): [blocking] add versioning and migration flow here
      return slate;
    }
  } catch (err) {
    // todo (yoav): report this error to the user
    console.error(err);
  }

  return null;
};

export const syncDevlink = (nodePath: string) => {
  const cwd = nodePath;
  // todo (yoav): maybe a status bar system with ids so we can show running jobs
  // in the status bar, and open up their terminal windows from there if you want?
  // or the sidebar or anywhere else.
  // for now just run it sync and show a tiny indicator
  const cmd = BUN_BINARY_PATH;
  const args = ["run", "--bun", "sync"];
  const process = spawn(cmd, args, {
    cwd,
    env: { PATH: COLAB_ENV_PATH },
  });

  process.stdout.on("data", (data) => {
    console.log("out", data.toString());
    // todo (yoav): do more processing here, like colorizing
    console.log(data.toString());
  });
  process.stderr.on("data", (data) => {
    console.log("err", data.toString());
    // todo (yoav): do more processing here, like colorizing
    console.log(data.toString());
  });

  process.addListener("error", (err) => {
    console.log("error", err);
  });

  process.addListener("exit", (code, signal) => {
    console.log("exit", code, signal);
    // setDevlinkSyncing(false);
  });
};

type FindAllInFolderResult = {
  path: string;
  line: number;
  column: number;
  match: string;
};

export function findAllInFolder(
  path: string,
  query: string = "",
  onResult: (result: FindAllInFolderResult) => void
): Subprocess {
  // Use bundled ripgrep for fast content search
  // ripgrep automatically respects .gitignore files
  const findAllProcess = Bun.spawn(
    [
      RG_BINARY_PATH,
      "--line-number",       // Show line numbers
      "--column",            // Show column numbers
      "--no-heading",        // Don't group by file
      "--color=never",       // No ANSI color codes
      "--case-sensitive",    // Case sensitive (can be toggled later)
      "--max-count=500",     // Limit to 500 matches per file (prevents massive result sets)
      // ripgrep respects .gitignore by default
      query,
      path,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  function processLine(line: string) {
    // ripgrep format: path:line:column:match
    const parts = line.split(":");
    if (parts.length >= 4) {
      const path = parts[0];
      const lineNum = parseInt(parts[1], 10);
      const column = parseInt(parts[2], 10);
      const match = parts.slice(3).join(":"); // Handles matches containing ":"

      onResult({ path, line: lineNum, column, match });
    }
  }

  // Buffer for accumulating chunks of data
  let stdoutBuffer = "";

  // Listen for data events from stdout
  const reader = findAllProcess.stdout.getReader();

  async function readStream() {
    const { done, value } = await reader.read();

    // Convert the chunk to a string and accumulate it in the buffer
    stdoutBuffer += new TextDecoder().decode(value);

    // Split the buffer by newlines to process full lines
    const lines = stdoutBuffer.split("\n");

    // Process all complete lines, keep incomplete one in the buffer
    for (let i = 0; i < lines.length - 1; i++) {
      processLine(lines[i]);
    }

    // Keep the last incomplete line in the buffer
    stdoutBuffer = lines[lines.length - 1];

    // recurse
    if (!done) {
      readStream();
    }
  }

  readStream();

  return findAllProcess;
}

export function findFilesInFolder(
  path: string,
  query: string = "",
  onResult: (result: string) => void
): Subprocess {
  // Use bundled fd (faster alternative to find) if available, otherwise fall back to find
  // fd is much faster and has better defaults for developer workflows

  // Create fuzzy match pattern (e.g., "abc" -> ".*a.*b.*c.*")
  const fuzzyPattern = query.split("").join(".*");

  // Check if bundled fd exists
  const useFd = existsSync(FD_BINARY_PATH);

  const fdCommand = [
    FD_BINARY_PATH,          // Use bundled fd
    "--type", "f",           // Only files
    "--hidden",              // Include hidden files
    // Note: Respects .gitignore by default (no --no-ignore)
    "--exclude", ".git",     // Exclude .git
    "--full-path",           // Search full path, not just filename
    // Note: fd is case-insensitive by default, no flag needed
    fuzzyPattern,            // The fuzzy pattern
    path,                    // Search path
  ];

  const findCommand = [
    "find",
    path,
    "-type",
    "f",
    "-not",
    "-path",
    "*/.git/*",
    "-not",
    "-path",
    "*/node_modules/*",
    "-not",
    "-path",
    "*/build/*",
    "-not",
    "-path",
    "*/dist/*",
    "-iregex",
    `.*${fuzzyPattern}.*`,
  ];

  // Use fd if available, otherwise fall back to find
  const findAllProcess = Bun.spawn(useFd ? fdCommand : findCommand, {
    stdout: "pipe",
    stderr: "pipe",
  });

  function processLine(line: string) {
    if (line.length >= 1) {
      onResult(line);
    }
  }

  // Buffer for accumulating chunks of data
  let stdoutBuffer = "";

  // Listen for data events from stdout
  const reader = findAllProcess.stdout.getReader();

  async function readStream() {
    const { done, value } = await reader.read();

    // Convert the chunk to a string and accumulate it in the buffer
    stdoutBuffer += new TextDecoder().decode(value);
    // Split the buffer by newlines to process full lines
    const lines = stdoutBuffer.split("\n");

    // Process all complete lines, keep incomplete one in the buffer
    for (let i = 0; i < lines.length - 1; i++) {
      processLine(lines[i]);
    }

    // Keep the last incomplete line in the buffer
    stdoutBuffer = lines[lines.length - 1];

    // recurse
    if (!done) {
      readStream();
    }
  }

  readStream();

  return findAllProcess;
}
/**
 * Finds the first nested git repository within a directory
 * Uses the bundled fd binary for fast searching
 * @param searchPath - The directory path to search in
 * @param timeoutMs - Timeout in milliseconds (default: 5000ms = 5s)
 * @returns The path to the first .git directory found, or null if none found or timeout
 */
export async function findFirstNestedGitRepo(
  searchPath: string,
  timeoutMs: number = 5000
): Promise<string | null> {
  if (!existsSync(FD_BINARY_PATH)) {
    console.error('[findFirstNestedGitRepo] fd binary not found at:', FD_BINARY_PATH);
    return null;
  }

  try {
    const fdCommand = [
      FD_BINARY_PATH,
      "--type", "d",              // Only directories
      "--hidden",                 // Include hidden directories
      "--max-results", "1",       // Stop after finding first match
      "^.git$",                   // Match .git exactly (full depth search)
      searchPath,                 // Search path
    ];

    const proc = Bun.spawn(fdCommand, {
      stdout: "pipe",
      stderr: "pipe",
    });

    // Race between the fd process and a timeout
    const resultPromise = new Response(proc.stdout).text();
    const timeoutPromise = new Promise<string>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve('TIMEOUT');
      }, timeoutMs);
    });

    const output = await Promise.race([resultPromise, timeoutPromise]);

    // Clean up the process if still running
    if (!proc.killed) {
      await proc.exited;
    }

    if (output === 'TIMEOUT') {
      console.warn('[findFirstNestedGitRepo] Search timed out after', timeoutMs, 'ms');
      return null;
    }

    const trimmedOutput = output.trim();
    return trimmedOutput ? trimmedOutput : null;
  } catch (error) {
    console.error('[findFirstNestedGitRepo] Error:', error);
    return null;
  }
}
