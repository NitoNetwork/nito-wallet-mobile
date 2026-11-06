import { readFileSync } from 'node:fs';

const expiresAt = Date.parse('2027-02-06T00:00:00Z');
const expectedWarnings = [
  "WARNING: The option setting 'android.builtInKotlin=false' is deprecated.",
  "WARNING: The option setting 'android.newDsl=false' is deprecated.",
  "WARNING: API 'applicationVariants' is obsolete and has been replaced with 'AndroidComponentsExtension'.",
  "WARNING: API 'testVariants' is obsolete and has been replaced with 'AndroidComponentsExtension'.",
  "WARNING: API 'unitTestVariants' is obsolete and has been replaced with 'AndroidComponentsExtension'.",
  "WARNING: API 'libraryVariants' is obsolete and has been replaced with 'AndroidComponentsExtension'.",
  'Using a Project object as a dependency notation has been deprecated. This will fail with an error in Gradle 10. Please use the project(String) method on DependencyHandler or the createProjectDependency(String) method on DependencyFactory instead. Consult the upgrading guide for further information: https://docs.gradle.org/9.6.1/userguide/upgrading_version_9.html#dependency_project_notation',
];
const allowedDependencyWarnings = [
  /^warning: Bundler cache is empty, rebuilding \(this may take a minute\)$/,
  /^w: file:\/\/\/.*\/node_modules\/@react-native\/gradle-plugin\/(?:react-native-gradle-plugin|settings-plugin|shared|shared-testutil)\/build\.gradle\.kts:\d+:\d+: 'val properties: \(Mutable\)Map<String, out Any\?>' is deprecated\. Deprecated in Java\.$/,
  /^w: file:\/\/\/.*\/node_modules\/@react-native\/gradle-plugin\/react-native-gradle-plugin\/src\/main\/kotlin\/com\/facebook\/react\/utils\/AgpConfiguratorUtils\.kt:\d+:\d+ 'val properties: [^']+' is deprecated\. Deprecated in Java\.$/,
  /^The Project\.getProperties method has been deprecated\. This will fail with an error in Gradle 10\. Consult the upgrading guide for further information: https:\/\/docs\.gradle\.org\/9\.6\.1\/userguide\/upgrading_version_9\.html#deprecated_get_properties$/,
  /^w: file:\/\/\/.*\/node_modules\/expo-modules-core\/android\/src\/main\/java\/expo\/modules\/kotlin\/(?:jni|types)\/(?:CppType|JavaCallback|NativeArrayBuffer|JSTypeConverter|ReturnType|TypeConverterProvider)\.kt:\d+:\d+ '(?:class NativeArrayBuffer : Destructible|constructor\(byteBuffer: ByteBuffer\): NativeArrayBuffer)' is deprecated\. Use ArrayBuffer instead\.$/,
  /^w: file:\/\/\/.*\/node_modules\/expo\/node_modules\/@expo\/dom-webview\/android\/src\/main\/java\/expo\/modules\/webview\/DomWebView\.kt:\d+:\d+ 'var allowFileAccessFromFileURLs: Boolean' is deprecated\. Deprecated in Java\.$/,
  /^w: file:\/\/\/.*\/node_modules\/expo\/node_modules\/@expo\/dom-webview\/android\/src\/main\/java\/expo\/modules\/webview\/DomWebView\.kt:\d+:\d+ 'fun executeOnJavaScriptThread\(runnable: Runnable\): Unit' is deprecated\. Use RuntimeContext\.schedule instead\.$/,
  /^w: file:\/\/\/.*\/node_modules\/expo-file-system\/android\/src\/main\/java\/expo\/modules\/filesystem\/(?:FileSystemFile|FileSystemModule)\.kt:\d+:\d+ 'class NativeArrayBuffer : Destructible' is deprecated\. Use ArrayBuffer instead\.$/,
  /^w: file:\/\/\/.*\/node_modules\/expo\/android\/src\/main\/java\/expo\/modules\/(?:ExpoModulesPackage|ReactActivityDelegateWrapper|fetch\/NativeResponse)\.kt:\d+:\d+ This declaration overrides a deprecated member but is not marked as deprecated itself\. Add the '@Deprecated' annotation or suppress the diagnostic\.$/,
  /^w: file:\/\/\/.*\/node_modules\/expo\/android\/src\/main\/java\/expo\/modules\/ReactActivityDelegateWrapper\.kt:\d+:\d+ '(?:class ReactInstanceManager : Any|val reactInstanceManager: ReactInstanceManager)' is deprecated\. Deprecated in Java\.$/,
  /^w: file:\/\/\/.*\/node_modules\/expo\/android\/src\/main\/java\/expo\/modules\/fetch\/ExpoFetchModule\.kt:\d+:\d+ 'class NativeArrayBuffer : Destructible' is deprecated\. Use ArrayBuffer instead\.$/,
  /^w: file:\/\/\/.*\/node_modules\/expo\/android\/src\/main\/java\/expo\/modules\/fetch\/ExpoFetchModule\.kt:\d+:\d+ 'constructor\(reactContext: ReactContext\): ForwardingCookieHandler' is deprecated\. Use the default constructor\.$/,
  /^w: file:\/\/\/.*\/node_modules\/expo\/android\/src\/main\/java\/expo\/modules\/fetch\/ExpoFetchModule\.kt:\d+:\d+ 'constructor\(byteBuffer: ByteBuffer\): NativeArrayBuffer' is deprecated\. Use ArrayBuffer instead\.$/,
  /^w: file:\/\/\/.*\/node_modules\/expo\/android\/src\/main\/java\/expo\/modules\/fetch\/NativeResponse\.kt:\d+:\d+ 'fun deallocate\(\): Unit' is deprecated\. Use sharedObjectDidRelease\(\) instead\.$/,
];
const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
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
  /has been deprecated\./i,
  /deprecated gradle features were used/i,
  /has been deprecated and is scheduled to be removed/i,
  /will be run during every build because it does not specify any outputs/i,
];

function inspect(content) {
  const counts = new Map(expectedWarnings.map((warning) => [warning, 0]));
  const unexpected = [];

  content
    .replace(ansiPattern, '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const normalized = line.trim();
      if (counts.has(normalized)) {
        counts.set(normalized, counts.get(normalized) + 1);
        return;
      }
      if (allowedDependencyWarnings.some((pattern) => pattern.test(normalized))) {
        return;
      }
      if (normalized && diagnosticPatterns.some((pattern) => pattern.test(line))) {
        unexpected.push(`${index + 1}: ${line}`);
      }
    });

  const invalidCounts = [...counts.entries()].filter(([, count]) => count !== 1);
  return { invalidCounts, unexpected };
}

function selfTest() {
  const dependencySamples = [
    'warning: Bundler cache is empty, rebuilding (this may take a minute)',
    "w: file:///workspace/node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/build.gradle.kts:71:17: 'val properties: (Mutable)Map<String, out Any?>' is deprecated. Deprecated in Java.",
    "w: file:///workspace/node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/src/main/kotlin/com/facebook/react/utils/AgpConfiguratorUtils.kt:85:31 'val properties: (Mutable)Map<String, out @Nullable() Any?>' is deprecated. Deprecated in Java.",
    'The Project.getProperties method has been deprecated. This will fail with an error in Gradle 10. Consult the upgrading guide for further information: https://docs.gradle.org/9.6.1/userguide/upgrading_version_9.html#deprecated_get_properties',
    "w: file:///workspace/node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/jni/CppType.kt:42:23 'class NativeArrayBuffer : Destructible' is deprecated. Use ArrayBuffer instead.",
    "w: file:///workspace/node_modules/expo/node_modules/@expo/dom-webview/android/src/main/java/expo/modules/webview/DomWebView.kt:200:16 'var allowFileAccessFromFileURLs: Boolean' is deprecated. Deprecated in Java.",
    "w: file:///workspace/node_modules/expo/node_modules/@expo/dom-webview/android/src/main/java/expo/modules/webview/DomWebView.kt:254:18 'fun executeOnJavaScriptThread(runnable: Runnable): Unit' is deprecated. Use RuntimeContext.schedule instead.",
    "w: file:///workspace/node_modules/expo-file-system/android/src/main/java/expo/modules/filesystem/FileSystemFile.kt:9:8 'class NativeArrayBuffer : Destructible' is deprecated. Use ArrayBuffer instead.",
    "w: file:///workspace/node_modules/expo/android/src/main/java/expo/modules/ExpoModulesPackage.kt:34:16 This declaration overrides a deprecated member but is not marked as deprecated itself. Add the '@Deprecated' annotation or suppress the diagnostic.",
    "w: file:///workspace/node_modules/expo/android/src/main/java/expo/modules/ReactActivityDelegateWrapper.kt:22:8 'class ReactInstanceManager : Any' is deprecated. Deprecated in Java.",
    "w: file:///workspace/node_modules/expo/android/src/main/java/expo/modules/fetch/ExpoFetchModule.kt:15:8 'class NativeArrayBuffer : Destructible' is deprecated. Use ArrayBuffer instead.",
    "w: file:///workspace/node_modules/expo/android/src/main/java/expo/modules/fetch/ExpoFetchModule.kt:33:39 'constructor(reactContext: ReactContext): ForwardingCookieHandler' is deprecated. Use the default constructor.",
    "w: file:///workspace/node_modules/expo/android/src/main/java/expo/modules/fetch/ExpoFetchModule.kt:111:27 'constructor(byteBuffer: ByteBuffer): NativeArrayBuffer' is deprecated. Use ArrayBuffer instead.",
    "w: file:///workspace/node_modules/expo/android/src/main/java/expo/modules/fetch/NativeResponse.kt:46:11 'fun deallocate(): Unit' is deprecated. Use sharedObjectDidRelease() instead.",
  ];
  const clean = inspect([...expectedWarnings, 'BUILD SUCCESSFUL'].join('\n'));
  const missing = inspect(expectedWarnings.slice(1).join('\n'));
  const duplicate = inspect([...expectedWarnings, expectedWarnings[0]].join('\n'));
  const unexpected = inspect([...expectedWarnings, 'warning: unexpected diagnostic'].join('\n'));
  const knownDependencyWarning = inspect([...expectedWarnings, ...dependencySamples].join('\n'));
  const dependencySamplesCovered = allowedDependencyWarnings.every((pattern) =>
    dependencySamples.some((sample) => pattern.test(sample)),
  );
  const wrongDependencyWarning = inspect(
    [
      ...expectedWarnings,
      "w: file:///workspace/node_modules/another-package/android/src/main/java/CppType.kt:42:23 'class NativeArrayBuffer : Destructible' is deprecated. Use ArrayBuffer instead.",
    ].join('\n'),
  );

  if (
    clean.invalidCounts.length !== 0 ||
    clean.unexpected.length !== 0 ||
    missing.invalidCounts.length !== 1 ||
    duplicate.invalidCounts.length !== 1 ||
    unexpected.unexpected.length !== 1 ||
    knownDependencyWarning.unexpected.length !== 0 ||
    !dependencySamplesCovered ||
    wrongDependencyWarning.unexpected.length !== 1
  ) {
    throw new Error(
      `Gradle SDK 58 warning policy self-test failed: ${JSON.stringify({
        clean,
        missing,
        duplicate,
        unexpected,
        knownDependencyWarning,
        dependencySamplesCovered,
        wrongDependencyWarning,
      })}`,
    );
  }
  console.log('Gradle SDK 58 warning policy self-test passed.');
}

if (process.argv[2] === '--self-test') {
  selfTest();
  process.exit(0);
}

if (Date.now() >= expiresAt) {
  throw new Error('The Expo SDK 58 Gradle compatibility policy expired on 2027-02-06. Reassess the Android toolchain.');
}

const logFiles = process.argv.slice(2);
if (logFiles.length === 0) {
  throw new Error('Pass at least one Gradle build log path.');
}

let failed = false;
for (const logFile of logFiles) {
  const { invalidCounts, unexpected } = inspect(readFileSync(logFile, 'utf8'));
  if (invalidCounts.length === 0 && unexpected.length === 0) {
    console.log(`${logFile}: exact Expo SDK 58 compatibility warnings verified.`);
    continue;
  }

  failed = true;
  for (const [warning, count] of invalidCounts) {
    console.error(`${logFile}: expected exactly one occurrence, found ${count}: ${warning}`);
  }
  for (const finding of unexpected) {
    console.error(`${logFile}: unexpected diagnostic at ${finding}`);
  }
}

if (failed) process.exit(1);
