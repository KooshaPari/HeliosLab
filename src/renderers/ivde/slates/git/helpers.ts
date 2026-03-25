import type { FileChangeType, GitChangeCode } from "./types";

const FALLBACK_CHANGE_CODE: GitChangeCode = "";

export const parseStatusLine = (line: string): FileChangeType => {
  const changeType = line.slice(0, 1) as GitChangeCode;
  const relPath = line.slice(3);
  return {
    changeType: changeType || FALLBACK_CHANGE_CODE,
    relPath,
  };
};
