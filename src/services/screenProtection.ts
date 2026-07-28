import type { AppScreen } from '../ui/types';

export const shouldProtectIosAppSwitcher = ({
  screen,
  importPhraseVisible,
  seedBackupInProgress,
}: {
  screen: AppScreen;
  importPhraseVisible: boolean;
  seedBackupInProgress: boolean;
}): boolean => (
  screen === 'wallet'
  || (screen === 'import' && importPhraseVisible)
  || (screen === 'persist' && seedBackupInProgress)
);
