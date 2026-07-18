const fs = require('node:fs');
const path = require('node:path');
const {
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withProjectBuildGradle,
} = require('@expo/config-plugins');

const GRADLE_VERSION = '8.14.5';

function replaceRequired(contents, pattern, replacement, label) {
  if (!pattern.test(contents)) {
    throw new Error(`Unable to apply Android build policy: ${label}`);
  }
  return contents.replace(pattern, replacement);
}

function modernizeAssignment(contents, property) {
  const pattern = new RegExp(`^(\\s*)${property}\\s+([^=\\r\\n].*)$`, 'gm');
  return contents.replace(pattern, `$1${property} = $2`);
}

function configureProjectGradle(contents) {
  let next = contents.replace(
    /maven\s*\{\s*url\s+(['"][^'"]+['"])\s*\}/g,
    'maven { url = uri($1) }',
  );

  if (!next.includes('// NITO_STRICT_NATIVE_BUILD')) {
    next += `

// NITO_STRICT_NATIVE_BUILD
subprojects {
  tasks.withType(JavaCompile).configureEach {
          options.compilerArgs.add("-Werror")
  }
  plugins.withId("org.jetbrains.kotlin.android") {
    tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
      compilerOptions.allWarningsAsErrors.set(true)
    }
  }
}
`;
  }

  return next;
}

function configureAppGradle(contents) {
  let next = contents.replace(/^\s*buildToolsVersion\s+.*(?:\r?\n)?/gm, '');
  for (const property of [
    'ndkVersion',
    'compileSdk',
    'compileSdkVersion',
    'namespace',
    'applicationId',
    'minSdk',
    'minSdkVersion',
    'targetSdk',
    'targetSdkVersion',
    'versionCode',
    'versionName',
    'signingConfig',
    'shrinkResources',
    'minifyEnabled',
    'crunchPngs',
    'useLegacyPackaging',
    'ignoreAssetsPattern',
  ]) {
    next = modernizeAssignment(next, property);
  }
  if (!next.includes('// NITO_STRICT_APP_LINT')) {
    next += `

// NITO_STRICT_APP_LINT
android {
  lint {
    abortOnError = true
    warningsAsErrors = true
    checkReleaseBuilds = true
  }
}
`;
  }
  if (!next.includes('// NITO_RELEASE_SIGNING')) {
    next += `

// NITO_RELEASE_SIGNING
def nitoReleaseStorePath = System.getenv("NITO_ANDROID_KEYSTORE_PATH")
def nitoReleaseStorePassword = System.getenv("NITO_ANDROID_KEYSTORE_PASSWORD")
def nitoReleaseKeyAlias = System.getenv("NITO_ANDROID_KEY_ALIAS")
def nitoReleaseKeyPassword = System.getenv("NITO_ANDROID_KEY_PASSWORD")
def nitoReleaseSigningValues = [
  nitoReleaseStorePath,
  nitoReleaseStorePassword,
  nitoReleaseKeyAlias,
  nitoReleaseKeyPassword,
]

if (nitoReleaseSigningValues.any { value -> value == null || value.trim().isEmpty() }) {
  throw new GradleException("Nito Android release signing credentials are required")
}

android {
  signingConfigs {
    create("nitoRelease") {
      storeFile = file(nitoReleaseStorePath)
      storePassword = nitoReleaseStorePassword
      keyAlias = nitoReleaseKeyAlias
      keyPassword = nitoReleaseKeyPassword
    }
  }
  buildTypes {
    release {
      signingConfig = signingConfigs.getByName("nitoRelease")
    }
  }
}
`;
  }
  return next;
}

module.exports = function withNitoAndroidBuildPolicy(config) {
  config = withGradleProperties(config, (propertiesConfig) => {
    const key = 'org.gradle.java.installations.auto-download';
    propertiesConfig.modResults = propertiesConfig.modResults.filter(
      (entry) => entry.type !== 'property' || entry.key !== key,
    );
    propertiesConfig.modResults.push({ type: 'property', key, value: 'false' });
    return propertiesConfig;
  });

  config = withProjectBuildGradle(config, (projectConfig) => {
    projectConfig.modResults.contents = configureProjectGradle(projectConfig.modResults.contents);
    return projectConfig;
  });

  config = withAppBuildGradle(config, (appConfig) => {
    appConfig.modResults.contents = configureAppGradle(appConfig.modResults.contents);
    return appConfig;
  });

  return withDangerousMod(config, [
    'android',
    async (dangerousConfig) => {
      const wrapperPath = path.join(
        dangerousConfig.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties',
      );
      const original = fs.readFileSync(wrapperPath, 'utf8');
      const updated = replaceRequired(
        original,
        /gradle-[0-9.]+-bin\.zip/,
        `gradle-${GRADLE_VERSION}-bin.zip`,
        'Gradle wrapper version',
      );
      fs.writeFileSync(wrapperPath, updated, 'utf8');
      return dangerousConfig;
    },
  ]);
};
