import { spawnSync } from "node:child_process";
import { BIOME_BINARY_PATH } from "../consts/paths";

export const formatFile = (path: string) => {
	if (BIOME_BINARY_PATH) {
		const result = spawnSync(BIOME_BINARY_PATH, ["format", "--write", path]);

		if (result.status !== 0 && result.stderr && result.stderr.length > 0) {
			console.error("biome format error:", result.stderr.toString().trim());
		}
	}
};
