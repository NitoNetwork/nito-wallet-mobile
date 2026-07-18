import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const forbidden = [
  ['Java/Kotlin warning suppression', /@Suppress(?:Warnings|Lint)?\b/],
  ['Java warning suppression API', /suppressWarnings\b/],
  ['compiler warning suppression', /(?:-nowarn|-Xlint:none|-Xlint:-\S+|-Wno-\S+)/],
  ['compiler diagnostic suppression', /diagnostic\s+ignored/i],
  ['TypeScript diagnostic suppression', /(?:@ts-ignore|@ts-expect-error)\b/],
  ['ESLint diagnostic suppression', /eslint-disable\b/],
  ['Gradle warning suppression', /org\.gradle\.warning\.mode\s*=\s*none\b/i],
  ['Android lint suppression', /(?:abortOnError|warningsAsErrors|allWarningsAsErrors)\s*(?:=\s*)?false\b/i],
  ['Xcode warning suppression', /(?:GCC_WARN_INHIBIT_ALL_WARNINGS|SWIFT_SUPPRESS_WARNINGS)\s*=\s*YES\b/i],
  ['Xcode package validation bypass', /(?:skipPackagePluginValidation|skipMacroValidation)\b/],
  ['package export warning bypass', /unstable_enablePackageExports\b/],
  ['TypeScript deprecation bypass', /ignoreDeprecations\b/],
];

const textExtensions = new Set([
  '.c', '.cc', '.cjs', '.cpp', '.css', '.gradle', '.h', '.hpp', '.java', '.js',
  '.json', '.kt', '.kts', '.m', '.mm', '.mjs', '.pbxproj', '.plist', '.podspec',
  '.properties', '.rb', '.rs', '.sh', '.swift', '.toml', '.ts', '.tsx', '.xml',
  '.yaml', '.yml', '.patch',
]);
const textBasenames = new Set(['Gemfile', 'Podfile', 'gradlew']);
const ignoredDirectories = new Set([
  '.cxx', '.gradle', '.git', 'Pods', 'build', 'DerivedData', 'node_modules', 'target',
]);
const scannerPath = 'scripts/assert-no-warning-suppressions.mjs';

function normalizePath(file) {
  return file.replaceAll('\\', '/');
}

function isTextFile(file) {
  const normalized = normalizePath(file);
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  return textBasenames.has(basename) || textExtensions.has(extname(basename));
}

function collectGeneratedFiles(root, destination) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      collectGeneratedFiles(entryPath, destination);
    } else if (entry.isFile() && isTextFile(entryPath)) {
      destination.add(normalizePath(entryPath));
    }
  }
}

function inspectLine(file, line, lineNumber, findings) {
  for (const [label, pattern] of forbidden) {
    if (pattern.test(line)) {
      findings.push(`${file}:${lineNumber}: ${label}: ${line.trim()}`);
    }
  }
}

const files = new Set(
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter((file) => file !== scannerPath && isTextFile(file)),
);
collectGeneratedFiles('android', files);
collectGeneratedFiles('ios', files);

const findings = [];
for (const file of [...files].sort()) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  content.split(/\r?\n/).forEach((line, index) => {
    if (file.startsWith('patches/')) {
      if (!line.startsWith('+') || line.startsWith('+++')) return;
      inspectLine(file, line.slice(1), index + 1, findings);
      return;
    }
    inspectLine(file, line, index + 1, findings);
  });
}

if (findings.length > 0) {
  console.error('Warning suppressions or validation bypasses are forbidden:');
  findings.forEach((finding) => console.error(finding));
  process.exit(1);
}

console.log('No warning suppression or validation bypass found.');
