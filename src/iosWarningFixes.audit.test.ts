/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import expoClipboardPatchSource from '../patches/expo-clipboard+58.0.4.patch?raw';
import expoModulesCorePatchSource from '../patches/expo-modules-core+58.0.30.patch?raw';
import expoModulesJsiPatchSource from '../patches/expo-modules-jsi+58.0.22.patch?raw';
import iosWarningGateSource from '../scripts/assert-ios-owned-warning-free.mjs?raw';

describe('iOS dependency warning fixes', () => {
  it('only enables Xcode 27 warning groups on a compiler that supports them', () => {
    expect(expoModulesJsiPatchSource).toContain('#if compiler(>=6.4)');
    expect(expoModulesJsiPatchSource).toContain('"-Werror", "ImplicitStrongCapture"');
    expect(expoModulesJsiPatchSource).toContain('"-Werror", "NoUsage"');
    expect(expoModulesJsiPatchSource).toContain('] + strictWarningFlags + [');
  });

  it('keeps the React bridge conformance out of the public Expo header', () => {
    expect(expoModulesCorePatchSource).toContain(
      'EXModuleRegistryHolderReactModule+Private.h',
    );
    expect(expoModulesCorePatchSource).toContain(
      '@interface EXModuleRegistryHolderReactModule () <RCTBridgeModule>',
    );
    expect(expoModulesCorePatchSource).toContain(
      '-@interface EXModuleRegistryHolderReactModule : NSObject <RCTBridgeModule>',
    );
  });

  it('restates the inherited Swift sendability contract for clipboard exceptions', () => {
    expect(expoClipboardPatchSource).toContain(
      'InvalidImageException: GenericException<String>, @unchecked Sendable',
    );
    expect(expoClipboardPatchSource).toContain(
      'PasteFailureException: Exception, @unchecked Sendable',
    );
  });

  it('still rejects the corrected diagnostics if any of them returns', () => {
    expect(iosWarningGateSource).toContain(
      "unknown warning group: 'ImplicitStrongCapture'",
    );
    expect(iosWarningGateSource).toContain("unknown warning group: 'NoUsage'");
    expect(iosWarningGateSource).toContain(
      "cannot find protocol definition for 'RCTBridgeModule'",
    );
    expect(iosWarningGateSource).toContain('corrected dependency regression');
    expect(iosWarningGateSource).toContain('InvalidImageException');
    expect(iosWarningGateSource).toContain('PasteFailureException');
  });
});
