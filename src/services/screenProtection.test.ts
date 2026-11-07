import { describe, expect, it } from 'vitest';

import { shouldProtectSensitiveContent } from './screenProtection';

const protectionFor = (
  screen: Parameters<typeof shouldProtectSensitiveContent>[0]['screen'],
  overrides: Partial<Parameters<typeof shouldProtectSensitiveContent>[0]> = {},
) => shouldProtectSensitiveContent({
  screen,
  walletTab: 'home',
  createdPhraseVisible: false,
  settingsPhraseVisible: false,
  passphraseEntryVisible: false,
  ...overrides,
});

describe('sensitive content screen protection scope', () => {
  it('does not cover loading, landing, unlock, or initialization errors', () => {
    expect(protectionFor('loading')).toBe(false);
    expect(protectionFor('initializationError')).toBe(false);
    expect(protectionFor('landing')).toBe(false);
    expect(protectionFor('create')).toBe(false);
    expect(protectionFor('unlock')).toBe(false);
  });

  it('covers physical dice entry because its results contribute to the seed', () => {
    expect(protectionFor('dice')).toBe(true);
  });

  it('covers optional BIP39 passphrase entry on creation and import', () => {
    expect(protectionFor('create', { passphraseEntryVisible: true })).toBe(true);
    expect(protectionFor('import', { passphraseEntryVisible: true })).toBe(true);
  });

  it('covers only the creation step that actually displays the phrase', () => {
    expect(protectionFor('persist', { createdPhraseVisible: true })).toBe(true);
    expect(protectionFor('persist', { createdPhraseVisible: false })).toBe(false);
  });

  it('covers the phrase revealed from security settings and no other wallet tab', () => {
    expect(protectionFor('wallet', {
      walletTab: 'security',
      settingsPhraseVisible: true,
    })).toBe(true);
    expect(protectionFor('wallet', {
      walletTab: 'history',
      settingsPhraseVisible: true,
    })).toBe(false);
    expect(protectionFor('wallet', {
      walletTab: 'security',
      settingsPhraseVisible: false,
    })).toBe(false);
  });

  it('allows captures on import and ordinary wallet screens', () => {
    expect(protectionFor('import')).toBe(false);
    expect(protectionFor('wallet')).toBe(false);
  });
});
