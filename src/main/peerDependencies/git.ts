// mkdir homebrew && curl -L https://github.com/Homebrew/brew/tarball/master | tar xz --strip 1 -C homebrew

import { existsSync } from "node:fs";
import { GIT_BINARY_PATH } from "../consts/paths";
import { execSpawnSync } from "../utils/processUtils";

export const isInstalled = () => {
	return existsSync(GIT_BINARY_PATH);
};

export const getVersion = (_forceRefetch = false) => {
	const result = execSpawnSync(GIT_BINARY_PATH, ["--version"]);
	const versionResult = result.stdout || "";
	return versionResult.replace(/[^\d]*([\d.]+)[^\d]*/, "$1");
};

export const install = () => {
	if (isInstalled()) {
		return;
	}

	// Note: we should migrate to libgit2 for bun, but it's a bigger task
	// for now we just bundle the git binary (originally installed via homebrew)
	// via electrobun.config
	console.log("git not bundled correctly");
};
