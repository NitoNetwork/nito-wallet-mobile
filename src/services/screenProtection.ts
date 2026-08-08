import type { AppScreen, WalletTab } from '../ui/types';

export const shouldProtectSensitiveContent = ({
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
  screen === 'dice'
  || (screen === 'persist' && createdPhraseVisible)
  || (screen === 'wallet' && walletTab === 'security' && settingsPhraseVisible)
);
