export interface AppStateLockContext {
  nextState: string;
  systemPromptActive: boolean;
  walletOpen: boolean;
}

export const shouldLockWalletForAppState = ({
  nextState,
  systemPromptActive,
  walletOpen,
}: AppStateLockContext): boolean => (
  walletOpen
  && (
    nextState === 'background'
    || (nextState === 'inactive' && !systemPromptActive)
  )
);
