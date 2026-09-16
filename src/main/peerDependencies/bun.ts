import { existsSync } from "node:fs";
import { BUN_BINARY_PATH } from "../consts/paths";
import { execSpawnSync } from "../utils/processUtils";

export const isInstalled = () => {
	return existsSync(BUN_BINARY_PATH);
};

const _version: string = "";
export const getVersion = (_forceRefetch = false) => {
	const result = execSpawnSync(BUN_BINARY_PATH, ["--version"]);
	return result.stdout || "";
};

export const install = () => {
	if (isInstalled()) {
		return;
	}

	// Since we're using electrobun we have bun bundled
	console.log("bun not bundled correctly");
};
