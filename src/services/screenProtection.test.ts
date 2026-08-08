import { describe, expect, it } from 'vitest';

import { shouldProtectRecoveryPhrase } from './screenProtection';

const protectionFor = (
  screen: Parameters<typeof shouldProtectRecoveryPhrase>[0]['screen'],
  overrides: Partial<Parameters<typeof shouldProtectRecoveryPhrase>[0]> = {},
) => shouldProtectRecoveryPhrase({
  screen,
  walletTab: 'home',
  createdPhraseVisible: false,
  settingsPhraseVisible: false,
  ...overrides,
});

describe('recovery phrase screen protection scope', () => {
  it('does not cover loading, landing, dice, unlock, or initialization errors', () => {
    expect(protectionFor('loading')).toBe(false);
    expect(protectionFor('initializationError')).toBe(false);
    expect(protectionFor('landing')).toBe(false);
    expect(protectionFor('dice')).toBe(false);
    expect(protectionFor('unlock')).toBe(false);
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
