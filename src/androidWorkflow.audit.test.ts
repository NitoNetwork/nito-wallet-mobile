/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import androidWorkflowSource from '../.github/workflows/android-apk.yml?raw';

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
    expect(androidWorkflowSource).toContain('sdk install');
    expect(androidWorkflowSource).toContain('cd "$RUNNER_TEMP"');
    expect(androidWorkflowSource).toContain('"$ANDROID_PLATFORM_PACKAGE"');
    expect(androidWorkflowSource).toContain(
      '"build-tools/$ANDROID_BUILD_TOOLS_VERSION"',
    );
    expect(androidWorkflowSource).toContain('"ndk/$ANDROID_NDK_VERSION"');
    expect(androidWorkflowSource).toContain('test -s "$PLATFORM_DIRECTORY/android.jar"');
    expect(androidWorkflowSource).toContain('test -x "$BUILD_TOOLS_DIRECTORY/apksigner"');
    expect(androidWorkflowSource).toContain('test -s "$NDK_DIRECTORY/source.properties"');
    expect(androidWorkflowSource).toContain('AndroidVersion\\.ApiLevel=');
    expect(androidWorkflowSource.match(/Pkg\\\.Revision/g)).toHaveLength(2);
    expect(androidWorkflowSource).toContain('ANDROID_HOME=$ANDROID_HOME');
    expect(androidWorkflowSource).toContain('ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT');
    expect(androidWorkflowSource).toContain('ANDROID_NDK_HOME=$NDK_DIRECTORY');
  });
});
