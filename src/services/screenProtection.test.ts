import { describe, expect, it } from 'vitest';

import { shouldProtectIosAppSwitcher } from './screenProtection';

const protectionFor = (
  screen: Parameters<typeof shouldProtectIosAppSwitcher>[0]['screen'],
  overrides: Partial<Parameters<typeof shouldProtectIosAppSwitcher>[0]> = {},
) => shouldProtectIosAppSwitcher({
  screen,
  importPhraseVisible: false,
  seedBackupInProgress: false,
  ...overrides,
});

describe('iOS app-switcher protection scope', () => {
  it('does not cover loading, landing, unlock, or initialization errors', () => {
    expect(protectionFor('loading')).toBe(false);
    expect(protectionFor('initializationError')).toBe(false);
    expect(protectionFor('landing')).toBe(false);
    expect(protectionFor('unlock')).toBe(false);
  });

  it('covers an open wallet and every active created-seed backup step', () => {
    expect(protectionFor('wallet')).toBe(true);
    expect(protectionFor('persist', { seedBackupInProgress: true })).toBe(true);
  });

  it('is removed before biometric opt-in after the created seed is confirmed', () => {
    expect(protectionFor('persist', { seedBackupInProgress: false })).toBe(false);
  });

  it('covers an imported phrase only while the user reveals it', () => {
    expect(protectionFor('import', { importPhraseVisible: false })).toBe(false);
    expect(protectionFor('import', { importPhraseVisible: true })).toBe(true);
  });
});
