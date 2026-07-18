import { readFileSync } from 'node:fs';

const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const informationalPatterns = [
  /^\s*=+\s*DEPRECATION NOTICE\s*=+\s*$/,
  /^\s*Calling `pod install` directly is deprecated in React Native\s*$/,
  /^\s*\[!\] Please close any current Xcode sessions and use `[^`]+\.xcworkspace` for this project from now on\.\s*$/,
  /^\s*\[!\] (?:ExpoCamera|ExpoCameraBarcodeScanning|ExpoFileSystem|ExpoFont|ExpoModulesCore|ExpoModulesWorklets) has added 2 script phases\. Please inspect before executing a build\. See `https:\/\/guides\.cocoapods\.org\/syntax\/podspec\.html#script_phases` for more information\.\s*$/,
  /^\s*\[!\] (?:React-Core-prebuilt|ReactNativeDependencies|hermes-engine) has added 1 script phase\. Please inspect before executing a build\. See `https:\/\/guides\.cocoapods\.org\/syntax\/podspec\.html#script_phases` for more information\.\s*$/,
];
const diagnosticPatterns = [
  /\bwarning:/i,
  /^\s*w:\s+/i,
  /^\s*npm\s+warn(?:ing)?\b/i,
  /^\s*warn(?:ing)?\s*\[[^\]]+\]/i,
  /^\s*\[warning\]/i,
  /^\s*::warning\b/i,
  /^\s*\[!\]\s+/,
  /DEPRECATION NOTICE/i,
  /Calling .* directly is deprecated/i,
  /deprecated gradle features were used/i,
  /has been deprecated and is scheduled to be removed/i,
  /will be run during every build because it does not specify any outputs/i,
];

function stripAnsi(value) {
  return value.replace(ansiPattern, '');
}

function isZeroWarningSummary(line) {
  return /^\s*(?:0\s+warnings?|0\s+problems?\s*\([^)]*0\s+warnings?[^)]*\)|no\s+warnings?)\s*\.?\s*$/i.test(line);
}

function isAuditedInformationalNotice(line) {
  return informationalPatterns.some((pattern) => pattern.test(line));
}

function findWarnings(content) {
  return stripAnsi(content)
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(
      ({ line }) =>
        line.trim() &&
        !isZeroWarningSummary(line) &&
        !isAuditedInformationalNotice(line),
    )
    .filter(({ line }) => diagnosticPatterns.some((pattern) => pattern.test(line)));
}

function selfTest() {
  const clean = findWarnings([
    'BUILD SUCCESSFUL',
    '0 warnings',
    '0 problems (0 errors, 0 warnings)',
    'No warnings.',
    './gradlew assembleRelease --warning-mode=fail',
    'Note: informational compiler output',
    '==================== DEPRECATION NOTICE =====================',
    'Calling `pod install` directly is deprecated in React Native',
    '[!] Please close any current Xcode sessions and use `NitoWallet.xcworkspace` for this project from now on.',
    '[!] hermes-engine has added 1 script phase. Please inspect before executing a build. See `https://guides.cocoapods.org/syntax/podspec.html#script_phases` for more information.',
  ].join('\n'));
  const dirty = findWarnings([
    'warning: deprecated API',
    'source.mm:42:7: warning: unused value',
    'AndroidManifest.xml Warning:',
    'w: unchecked conversion',
    'npm warn deprecated package',
    '[WARNING] Maven diagnostic',
    'Deprecated Gradle features were used in this build',
    'Run script build phase will be run during every build because it does not specify any outputs',
    '[!] Unknown CocoaPods diagnostic',
    '==================== DEPRECATION NOTICE: UNKNOWN =====================',
  ].join('\n'));
  if (clean.length !== 0 || dirty.length !== 10) {
    throw new Error(`Warning detector self-test failed: clean=${clean.length}, dirty=${dirty.length}.`);
  }
  console.log('Build log detector self-test passed.');
}

if (process.argv[2] === '--self-test') {
  selfTest();
  process.exit(0);
}

const logFiles = process.argv.slice(2);
if (logFiles.length === 0) {
  throw new Error('Pass at least one build log path.');
}

let failed = false;
for (const logFile of logFiles) {
  const findings = findWarnings(readFileSync(logFile, 'utf8'));
  if (findings.length === 0) {
    console.log(`${logFile}: clean`);
    continue;
  }

  failed = true;
  console.error(`${logFile}: ${findings.length} warning diagnostic(s) detected`);
  for (const finding of findings) {
    console.error(`${finding.number}: ${finding.line}`);
  }
}

if (failed) process.exit(1);
