import { readFileSync, writeFileSync } from "node:fs";
import { releaseVersion } from "./release-version.mjs";

const root = new URL("../", import.meta.url);
const checkOnly = process.argv.includes("--check");

function update(relativePath, transform) {
  const url = new URL(relativePath, root);
  const current = readFileSync(url, "utf8");
  const expected = transform(current);

  if (current === expected) {
    return true;
  }

  if (checkOnly) {
    console.error(`${relativePath} is not synchronized with version ${releaseVersion}.`);
    return false;
  }

  writeFileSync(url, expected);
  console.log(`Updated ${relativePath} to ${releaseVersion}.`);
  return true;
}

function replaceVersion(content, pattern, relativePath) {
  if (!pattern.test(content)) {
    throw new Error(`Version field not found in ${relativePath}.`);
  }
  return content.replace(pattern, `$1${releaseVersion}$2`);
}

const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20" role="img" aria-label="version: ${releaseVersion}">
  <title>version: ${releaseVersion}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="100" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="57" height="20" fill="#555"/>
    <rect x="57" width="43" height="20" fill="#1674d1"/>
    <rect width="100" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="28.5" y="15" fill="#010101" fill-opacity=".3">version</text>
    <text x="28.5" y="14">version</text>
    <text x="78.5" y="15" fill="#010101" fill-opacity=".3">${releaseVersion}</text>
    <text x="78.5" y="14">${releaseVersion}</text>
  </g>
</svg>
`;

const results = [
  update("native/NitoWalletCrypto.podspec", (content) =>
    replaceVersion(content, /(s\.version = ')[^']+(')/, "native/NitoWalletCrypto.podspec"),
  ),
  update("native/nito-wallet-crypto/Cargo.toml", (content) =>
    replaceVersion(
      content,
      /(\[package\]\r?\nname = "nito-wallet-crypto"\r?\nversion = ")[^"]+(")/,
      "native/nito-wallet-crypto/Cargo.toml",
    ),
  ),
  update("native/nito-wallet-crypto/Cargo.lock", (content) =>
    replaceVersion(
      content,
      /(\[\[package\]\]\r?\nname = "nito-wallet-crypto"\r?\nversion = ")[^"]+(")/,
      "native/nito-wallet-crypto/Cargo.lock",
    ),
  ),
  update("assets/version-badge.svg", () => badge),
];

const packageLock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
const lockMatches =
  packageLock.version === releaseVersion &&
  packageLock.packages?.[""]?.version === releaseVersion;

if (!lockMatches) {
  console.error(`package-lock.json is not synchronized with version ${releaseVersion}.`);
}

if (results.includes(false) || !lockMatches) {
  process.exitCode = 1;
}
