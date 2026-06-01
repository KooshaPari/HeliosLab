import { join, resolve } from "path";
import { Updater } from "electrobun";
import { existsSync, mkdirSync } from "fs";
import { getAppPath, getPath } from "../newapi";

const channel = await Updater.localInfo.channel();

const COLAB_HOME_FOLDER_NAME =
  channel === "stable" ? ".colab" : `.colab-${channel}`;

// colab
export const APP_PATH = getAppPath();
export const BUNDLED_BIN_PATH = resolve("./");

export const COLAB_HOME_FOLDER = join(getPath("home"), COLAB_HOME_FOLDER_NAME);
if (!existsSync(COLAB_HOME_FOLDER)) {
  mkdirSync(COLAB_HOME_FOLDER, { recursive: true });
}
export const COLAB_PROJECTS_FOLDER = join(COLAB_HOME_FOLDER, "projects");
if (!existsSync(COLAB_PROJECTS_FOLDER)) {
  mkdirSync(COLAB_PROJECTS_FOLDER, { recursive: true });
}

export const COLAB_GOLDFISHDB_PATH = join(COLAB_HOME_FOLDER, ".goldfishdb");
export const COLAB_DEPS_PATH = join(COLAB_HOME_FOLDER, ".deps");
export const COLAB_MODELS_PATH = join(COLAB_HOME_FOLDER, "models");
export const COLAB_PLUGINS_PATH = join(COLAB_HOME_FOLDER, "plugins");
export const COLAB_PLUGINS_REGISTRY_PATH = join(COLAB_PLUGINS_PATH, "registry.json");

mkdirSync(COLAB_DEPS_PATH, { recursive: true });
mkdirSync(COLAB_PLUGINS_PATH, { recursive: true });

// Create models directory lazily to avoid startup issues
try {
  if (!existsSync(COLAB_MODELS_PATH)) {
    mkdirSync(COLAB_MODELS_PATH, { recursive: true });
  }
} catch (error) {
  // Silently ignore directory creation errors to prevent startup crashes
  // The directory will be created later when needed
}

export const COLAB_ENV_PATH = `${COLAB_DEPS_PATH}`;

// peer dependencies
// binaries
export const BUN_BINARY_PATH = join(BUNDLED_BIN_PATH, "bun"); //join(COLAB_DEPS_PATH, "bun");
export const BIOME_BINARY_PATH = join(COLAB_DEPS_PATH, "biome");
export const LLAMA_CPP_BINARY_PATH = join(BUNDLED_BIN_PATH, "llama-cli");
export const TSSERVER_PATH = join(COLAB_DEPS_PATH, "tsserver");
// todo: switch to libgit2 and bundle it with co(lab)
export const GIT_VENDOR_PATH = join(BUNDLED_BIN_PATH, "vendor");
export const GIT_BINARY_PATH = join(GIT_VENDOR_PATH, "git");
export const FD_BINARY_PATH = join(BUNDLED_BIN_PATH, "vendor", "fd");
export const RG_BINARY_PATH = join(BUNDLED_BIN_PATH, "vendor", "rg");
// installations paths
// bun.sh
// create a folder for the bundled bun bin to install npm dependencies to
export const BUN_PATH = join(COLAB_HOME_FOLDER, ".bun");
export const BUN_DEPS_FOLDER = join(BUN_PATH, "node_modules");
if (!existsSync(BUN_DEPS_FOLDER)) {
  mkdirSync(BUN_DEPS_FOLDER, { recursive: true });
}

// node (needed for tsserver)
// TODO: switch to bun when tsserver works with bun
// export const NODE_BINARY_PATH = join(COLAB_DEPS_PATH, "node");
// export const NPM_BINARY_PATH = join(COLAB_DEPS_PATH, "npm");

// tsserver
export const TYPESCRIPT_PACKAGE_PATH = join(BUN_DEPS_FOLDER, "typescript");
// Note: the tsserver installed to .bin uses a shebang to call node, even with --bun flag io gets messed up
// so we use tsserver.js directly
// export const TSSERVER_PATH = join(TYPESCRIPT_PACKAGE_PATH,'lib', 'tsserver.js');
// biome
export const BIOME_PACKAGE_PATH = join(BUN_DEPS_FOLDER, "@biomejs", "biome");
// export const BIOME_BINARY_PATH = join(BUN_DEPS_FOLDER, '@biomejs', 'cli-darwin-arm64', 'biome');

/**
 * 
 const { platform, arch } = process;

const PLATFORMS = {
	win32: {
		x64: "@biomejs/cli-win32-x64/biome.exe",
		arm64: "@biomejs/cli-win32-arm64/biome.exe",
	},
	darwin: {
		x64: "@biomejs/cli-darwin-x64/biome",
		arm64: "@biomejs/cli-darwin-arm64/biome",
	},
	linux: {
		x64: "@biomejs/cli-linux-x64/biome",
		arm64: "@biomejs/cli-linux-arm64/biome",
	},
};

const binName = PLATFORMS?.[platform]?.[arch];
 * 
 */
