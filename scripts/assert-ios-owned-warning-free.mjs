import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const logPath = process.argv[2];
if (!logPath) {
  throw new Error('Usage: node scripts/assert-ios-owned-warning-free.mjs <xcode-log>');
}

const warningPattern = /\bwarning:/i;
const dependencyPattern = /(?:\/node_modules\/|\/ios\/Pods\/|\/Applications\/Xcode[^/]*\.app\/|\/Library\/Developer\/CommandLineTools\/)/;
const lines = readFileSync(logPath, 'utf8').split(/\r?\n/);
const warnings = lines.filter((line) => warningPattern.test(line));
const ownedWarnings = warnings.filter((line) => !dependencyPattern.test(line));

if (ownedWarnings.length > 0) {
  console.error(`Project warning gate failed for ${basename(logPath)}:`);
  for (const line of ownedWarnings) console.error(line);
  process.exit(1);
}

if (warnings.length > 0) {
  console.log(`Audited ${warnings.length} upstream toolchain/dependency warning line(s); no project-owned warning was found.`);
} else {
  console.log(`No warnings found in ${basename(logPath)}.`);
}
