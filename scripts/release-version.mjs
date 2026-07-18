import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version);

if (!match) {
  throw new Error(`Invalid release version: ${packageJson.version}`);
}

const [, majorText, minorText, patchText] = match;
const major = Number(majorText);
const minor = Number(minorText);
const patch = Number(patchText);

if (minor > 99 || patch > 99) {
  throw new Error("Release minor and patch numbers must remain between 0 and 99.");
}

export const releaseVersion = packageJson.version;
export const releaseBuildCode = major * 10_000 + minor * 100 + patch;

if (!Number.isSafeInteger(releaseBuildCode) || releaseBuildCode > 2_100_000_000) {
  throw new Error(`Unsupported release build code: ${releaseBuildCode}`);
}
