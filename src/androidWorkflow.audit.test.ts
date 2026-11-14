/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import androidAabWorkflowSource from '../.github/workflows/android-aab.yml?raw';
import androidWorkflowSource from '../.github/workflows/android-apk.yml?raw';
import androidSdkInstallerSource from '../scripts/install-android-sdk-with-retry.sh?raw';

describe('Android workflow toolchain contract', () => {
  it('installs the exact Expo SDK 58 toolchain through the pinned Android CLI', () => {
    expect(androidWorkflowSource).toContain('ANDROID_COMPILE_SDK: "37"');
    expect(androidWorkflowSource).toContain(
      'ANDROID_PLATFORM_PACKAGE: "platforms/android-37.0"',
    );
    expect(androidWorkflowSource).toContain('ANDROID_BUILD_TOOLS_VERSION: "37.0.0"');
    expect(androidWorkflowSource).toContain('ANDROID_NDK_VERSION: "27.1.12297006"');
    expect(androidWorkflowSource).toContain('ANDROID_CLI_VERSION: "1.1.16717390"');
    expect(androidWorkflowSource).toContain(
      'ANDROID_CLI_SHA256: "43204dcc42955f4698b7a7ca945f26c26f594f9239f5f8e11b3b73d4ceaa11ae"',
    );
    expect(androidWorkflowSource).toContain(
      'https://dl.google.com/android/cli/${ANDROID_CLI_VERSION}/linux_x86_64/android',
    );
    expect(androidWorkflowSource).not.toContain('/android/cli/latest/');
    expect(androidWorkflowSource).toContain('sha256sum --check --strict');
    expect(androidWorkflowSource).toContain('--no-metrics');
  });

  it('does not use the retired SDK manager and verifies every installed package', () => {
    expect(androidWorkflowSource).not.toContain('sdkmanager');
    expect(androidWorkflowSource).not.toContain('android-actions/setup-android');
    expect(androidWorkflowSource).not.toContain('platform-tools');
    expect(androidWorkflowSource).toContain(
      'bash scripts/install-android-sdk-with-retry.sh',
    );
    expect(androidAabWorkflowSource).toContain(
      'bash scripts/install-android-sdk-with-retry.sh',
    );
    expect(androidSdkInstallerSource).toContain('sdk install');
    expect(androidSdkInstallerSource).toContain('"$platform_package"');
    expect(androidSdkInstallerSource).toContain('"build-tools/$build_tools_version"');
    expect(androidSdkInstallerSource).toContain('"ndk/$ndk_version"');
    expect(androidWorkflowSource).toContain('test -s "$PLATFORM_DIRECTORY/android.jar"');
    expect(androidWorkflowSource).toContain('test -x "$BUILD_TOOLS_DIRECTORY/apksigner"');
    expect(androidWorkflowSource).toContain('test -s "$NDK_DIRECTORY/source.properties"');
    expect(androidWorkflowSource).toContain('AndroidVersion\\.ApiLevel=');
    expect(androidWorkflowSource.match(/Pkg\\\.Revision/g)).toHaveLength(2);
    expect(androidWorkflowSource).toContain('ANDROID_HOME=$ANDROID_HOME');
    expect(androidWorkflowSource).toContain('ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT');
    expect(androidWorkflowSource).toContain('ANDROID_NDK_HOME=$NDK_DIRECTORY');
  });

  it('retries transient Android SDK installation failures with bounded diagnostics', () => {
    expect(androidSdkInstallerSource).toContain(
      'NITO_ANDROID_SDK_INSTALL_ATTEMPTS:-3',
    );
    expect(androidSdkInstallerSource).toContain(
      'NITO_ANDROID_SDK_INSTALL_RETRY_DELAY_SECONDS:-15',
    );
    expect(androidSdkInstallerSource).toContain('attempt <= max_attempts');
    expect(androidSdkInstallerSource).toContain('max_attempts > 5');
    expect(androidSdkInstallerSource).toContain('retry_delay_seconds > 60');
    expect(androidSdkInstallerSource).toContain('verbosity=(-vv)');
    expect(androidSdkInstallerSource).toContain('exit "$install_status"');
  });

  it('builds the Play AAB independently with the same pinned quality and signing gates', () => {
    for (const expected of [
      'ANDROID_COMPILE_SDK: "37"',
      'ANDROID_PLATFORM_PACKAGE: "platforms/android-37.0"',
      'ANDROID_BUILD_TOOLS_VERSION: "37.0.0"',
      'ANDROID_NDK_VERSION: "27.1.12297006"',
      'ANDROID_CLI_VERSION: "1.1.16717390"',
      'npm audit 2>&1 | tee npm-audit-full.log',
      'npm run audit:production 2>&1 | tee npm-audit-production.log',
      'npm run test 2>&1 | tee vitest.log',
      ':app:lintRelease',
      ':app:testDebugUnitTest',
      ':app:bundleRelease',
      'jarsigner -verify "$AAB_PATH"',
      'keytool -exportcert',
      'keytool -printcert',
      'Nito-Wallet-Android-${VERSION}.aab',
      'Nito-Wallet-Android-Play-AAB',
    ]) {
      expect(androidAabWorkflowSource).toContain(expected);
    }

    expect(androidAabWorkflowSource).toContain('group: android-aab-${{ inputs.source_ref }}');
    expect(androidAabWorkflowSource).toContain('ref: ${{ inputs.source_ref }}');
    expect(androidAabWorkflowSource).toContain('NITO_ANDROID_KEYSTORE_BASE64');
    expect(androidAabWorkflowSource).toContain('NITO_ANDROID_KEYSTORE_PASSWORD_SECRET');
    expect(androidAabWorkflowSource).toContain('NITO_ANDROID_KEY_ALIAS_SECRET');
    expect(androidAabWorkflowSource).toContain('NITO_ANDROID_KEY_PASSWORD_SECRET');
    expect(androidAabWorkflowSource).toContain("grep -Fq 'jar verified.'");
    expect(androidAabWorkflowSource).toContain('BUNDLE_CERTIFICATE_REPORT=');
    expect(androidAabWorkflowSource).toContain('/-----BEGIN CERTIFICATE-----/');
    expect(androidAabWorkflowSource).toContain('/-----END CERTIFICATE-----/');
    expect(androidAabWorkflowSource).toContain(
      'cmp --silent "$EXPECTED_CERTIFICATE" "$BUNDLE_CERTIFICATE"',
    );
    expect(androidAabWorkflowSource).toContain(
      'The AAB signer does not match the configured Android upload certificate.',
    );
    expect(androidAabWorkflowSource).not.toContain(':app:assembleRelease');
    expect(androidAabWorkflowSource).not.toContain(
      'Refusing to publish an APK signed with an Android Debug certificate.',
    );
    expect(androidAabWorkflowSource).toContain(
      'Refusing to publish an AAB signed with an Android Debug certificate.',
    );
  });
});
