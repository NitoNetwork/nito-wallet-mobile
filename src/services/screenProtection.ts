import type { AppScreen, WalletTab } from '../ui/types';

export const shouldProtectRecoveryPhrase = ({
  screen,
  walletTab,
  createdPhraseVisible,
  settingsPhraseVisible,
}: {
  screen: AppScreen;
  walletTab: WalletTab;
  createdPhraseVisible: boolean;
  settingsPhraseVisible: boolean;
}): boolean => (
  (screen === 'persist' && createdPhraseVisible)
  || (screen === 'wallet' && walletTab === 'security' && settingsPhraseVisible)
);
