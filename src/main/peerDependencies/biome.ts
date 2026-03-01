import { existsSync, readFileSync, renameSync, unlinkSync } from "fs";
import { execSpawnSync } from "../utils/processUtils";
import {
  BUN_BINARY_PATH,
  BIOME_PACKAGE_PATH,
  BIOME_BINARY_PATH,
  BUN_DEPS_FOLDER,
} from "../consts/paths";
import { join } from "path";

const BIOME_VERSION = "2.3.13";

export const isInstalled = () => {
  console.log(
    "is biome installed? ",
    BIOME_BINARY_PATH,
    existsSync(BIOME_BINARY_PATH),
    getVersion(),
    BIOME_VERSION,
  );
  return existsSync(BIOME_BINARY_PATH) && getVersion() === BIOME_VERSION;
};

let _version: string = "";
export const getVersion = (forceRefetch = false) => {
  if (!forceRefetch && _version) {
    return _version;
  }

  const packgeJsonPath = join(BIOME_PACKAGE_PATH, "package.json");

  if (!existsSync(packgeJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(readFileSync(join(BIOME_PACKAGE_PATH, "package.json"), "utf8"));
    _version = packageJson.version;
    return _version;
  } catch (e) {
    console.error("error reading package.json", e);
  }
};

export const install = () => {
  if (isInstalled()) {
    return;
  }

  const installResult = execSpawnSync(BUN_BINARY_PATH, [
    "install",
    "--exact",
    `@biomejs/biome@${BIOME_VERSION}`,
  ]);

  const biomeFolder = process.arch === "x64" ? "cli-darwin-x64" : "cli-darwin-arm64";

  const installedBiomeBinaryPath = join(BUN_DEPS_FOLDER, "@biomejs", biomeFolder, "biome");
  if (existsSync(BIOME_BINARY_PATH)) {
    unlinkSync(BIOME_BINARY_PATH);
  }

  if (existsSync(installedBiomeBinaryPath)) {
    renameSync(installedBiomeBinaryPath, BIOME_BINARY_PATH);
  }

  // invalidate the cache
  getVersion(true);

  console.info("biome installResult", installResult);
};
