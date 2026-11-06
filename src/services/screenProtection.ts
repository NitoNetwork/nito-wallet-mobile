import type { AppScreen, WalletTab } from '../ui/types';

export const shouldProtectSensitiveContent = ({
  screen,
  walletTab,
  createdPhraseVisible,
  settingsPhraseVisible,
  passphraseEntryVisible,
}: {
  screen: AppScreen;
  walletTab: WalletTab;
  createdPhraseVisible: boolean;
  settingsPhraseVisible: boolean;
  passphraseEntryVisible: boolean;
}): boolean => (
  screen === 'dice'
  || passphraseEntryVisible
  || (screen === 'persist' && createdPhraseVisible)
  || (screen === 'wallet' && walletTab === 'security' && settingsPhraseVisible)
);
