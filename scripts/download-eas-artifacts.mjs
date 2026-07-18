import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [jsonPath, outputDir] = process.argv.slice(2);

if (!jsonPath || !outputDir) {
  console.error("Usage: node scripts/download-eas-artifacts.mjs <eas-build-json> <output-dir>");
  process.exit(2);
}

function parseJsonOutput(raw) {
  const firstObject = raw.indexOf("{");
  const firstArray = raw.indexOf("[");
  const firstJson =
    firstObject === -1
      ? firstArray
      : firstArray === -1
        ? firstObject
        : Math.min(firstObject, firstArray);

  if (firstJson === -1) {
    throw new Error("EAS output did not contain JSON.");
  }

  return JSON.parse(raw.slice(firstJson));
}

function asBuildList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.builds)) {
    return value.builds;
  }

  if (Array.isArray(value?.data)) {
    return value.data;
  }

  return [value];
}

function inferExtension(build, artifactUrl) {
  const urlPath = new URL(artifactUrl).pathname.toLowerCase();
  const extension = path.extname(urlPath);

  if (extension) {
    return extension;
  }

  if (build.platform?.toLowerCase() === "ios") {
    return ".ipa";
  }

  if (build.profile === "production" || build.distribution === "store") {
    return ".aab";
  }

  return ".apk";
}

function artifactUrlFor(build) {
  return (
    build.artifacts?.buildUrl ??
    build.artifacts?.applicationArchiveUrl ??
    build.artifacts?.applicationArchive ??
    build.artifactUrl ??
    build.buildUrl ??
    null
  );
}

const raw = await readFile(jsonPath, "utf8");
const parsed = parseJsonOutput(raw);
const builds = asBuildList(parsed);
await mkdir(outputDir, { recursive: true });

let downloaded = 0;

for (const build of builds) {
  const artifactUrl = artifactUrlFor(build);

  if (!artifactUrl) {
    continue;
  }

  const platform = (build.platform ?? "build").toString().toLowerCase();
  const profile = (build.profile ?? "unknown").toString().toLowerCase();
  const buildId = (build.id ?? Date.now()).toString().slice(0, 8);
  const extension = inferExtension(build, artifactUrl);
  const fileName = `nito-wallet-${platform}-${profile}-${buildId}${extension}`;
  const targetPath = path.join(outputDir, fileName);

  const response = await fetch(artifactUrl);

  if (!response.ok) {
    throw new Error(`Could not download ${artifactUrl}: HTTP ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(targetPath, bytes);
  console.log(`Downloaded ${fileName} (${bytes.length} bytes)`);
  downloaded += 1;
}

if (downloaded === 0) {
  throw new Error("No downloadable EAS artifact URL was found in the build JSON.");
}
