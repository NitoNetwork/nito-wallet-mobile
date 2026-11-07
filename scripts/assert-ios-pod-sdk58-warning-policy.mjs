import { readFileSync } from 'node:fs';

const expiresAt = Date.parse('2027-02-06T00:00:00Z');
const expectedWarningPattern = /^warning: The @ExpoModule class 'CoreModule' \((?:.*[\\/])?node_modules[\\/]expo-modules-core[\\/]ios[\\/]Core[\\/]Modules[\\/]CoreModule\.swift\) is internal, so the generated modules provider cannot reference it\. Declare it public to link it automatically, or use a lower access level such as private to opt it out of linking\.$/;
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

function isZeroWarningSummary(line) {
  return /^\s*(?:0\s+warnings?|0\s+problems?\s*\([^)]*0\s+warnings?[^)]*\)|no\s+warnings?)\s*\.?\s*$/i.test(line);
}

function inspect(content) {
  let expectedCount = 0;
  const unexpected = [];

  content
    .replace(ansiPattern, '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const normalized = line.trim();
      if (expectedWarningPattern.test(normalized)) {
        expectedCount += 1;
        return;
      }
      if (
        !normalized ||
        isZeroWarningSummary(normalized) ||
        informationalPatterns.some((pattern) => pattern.test(line))
      ) {
        return;
      }
      if (diagnosticPatterns.some((pattern) => pattern.test(line))) {
        unexpected.push(`${index + 1}: ${line}`);
      }
    });

  return { expectedCount, unexpected };
}

function isExpired(now) {
  return now >= expiresAt;
}

function selfTest() {
  const expected = "warning: The @ExpoModule class 'CoreModule' (/workspace/node_modules/expo-modules-core/ios/Core/Modules/CoreModule.swift) is internal, so the generated modules provider cannot reference it. Declare it public to link it automatically, or use a lower access level such as private to opt it out of linking.";
  const informational = [
    '==================== DEPRECATION NOTICE =====================',
    'Calling `pod install` directly is deprecated in React Native',
    '[!] Please close any current Xcode sessions and use `NitoWallet.xcworkspace` for this project from now on.',
    '[!] hermes-engine has added 1 script phase. Please inspect before executing a build. See `https://guides.cocoapods.org/syntax/podspec.html#script_phases` for more information.',
  ];
  const clean = inspect([expected, ...informational, 'Pod installation complete!'].join('\n'));
  const missing = inspect(informational.join('\n'));
  const duplicate = inspect([expected, expected].join('\n'));
  const wrongClass = inspect(expected.replace("'CoreModule'", "'AnotherModule'"));
  const wrongPackage = inspect(expected.replace('expo-modules-core', 'another-package'));
  const changedText = inspect(expected.replace('generated modules provider', 'generated provider'));
  const ansiWrapped = inspect(`\u001b[33m${expected}\u001b[0m`);
  const unrelated = inspect([expected, 'warning: unexpected diagnostic'].join('\n'));

  if (
    clean.expectedCount !== 1 ||
    clean.unexpected.length !== 0 ||
    missing.expectedCount !== 0 ||
    duplicate.expectedCount !== 2 ||
    wrongClass.expectedCount !== 0 ||
    wrongClass.unexpected.length !== 1 ||
    wrongPackage.expectedCount !== 0 ||
    wrongPackage.unexpected.length !== 1 ||
    changedText.expectedCount !== 0 ||
    changedText.unexpected.length !== 1 ||
    ansiWrapped.expectedCount !== 1 ||
    ansiWrapped.unexpected.length !== 0 ||
    unrelated.expectedCount !== 1 ||
    unrelated.unexpected.length !== 1 ||
    isExpired(expiresAt - 1) ||
    !isExpired(expiresAt)
  ) {
    throw new Error(
      `iOS SDK 58 pod warning policy self-test failed: ${JSON.stringify({
        clean,
        missing,
        duplicate,
        wrongClass,
        wrongPackage,
        changedText,
        ansiWrapped,
        unrelated,
      })}`,
    );
  }
  console.log('iOS SDK 58 pod warning policy self-test passed.');
}

if (isExpired(Date.now())) {
  throw new Error('The Expo SDK 58 iOS pod warning policy expired on 2027-02-06. Reassess the Expo toolchain.');
}

if (process.argv[2] === '--self-test') {
  selfTest();
  process.exit(0);
}

const logFiles = process.argv.slice(2);
if (logFiles.length === 0) {
  throw new Error('Pass at least one CocoaPods log path.');
}

let failed = false;
for (const logFile of logFiles) {
  const { expectedCount, unexpected } = inspect(readFileSync(logFile, 'utf8'));
  if (expectedCount === 1 && unexpected.length === 0) {
    console.log(`${logFile}: exact Expo SDK 58 CoreModule warning verified.`);
    continue;
  }

  failed = true;
  if (expectedCount !== 1) {
    console.error(`${logFile}: expected exactly one CoreModule warning, found ${expectedCount}.`);
  }
  for (const finding of unexpected) {
    console.error(`${logFile}: unexpected diagnostic at ${finding}`);
  }
}

if (failed) process.exit(1);
